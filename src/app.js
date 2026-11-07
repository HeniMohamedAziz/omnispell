(function () {
  'use strict';

  const STORAGE_KEY = 'omnispell_master_state_v1';

  const LANGUAGE_LABELS = {
    en: 'English',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    es: 'Spanish'
  };

  const MODE_TITLES = {
    '2': '1. FOLLOW THE SOUND',
    '3': '2. GUESS THE WORD',
    '1': '3. COMPLETE SENTENCE',
    '4': 'WORDS TO MASTER (3x CONSECUTIVE)'
  };

  let pendingLoginProfileId = null;
  let pendingDeleteProfileId = null;
  let inspectedListId = null;
  let availableVoices = [];
  let countdownTimerId = null;
  let autoAdvanceTimerId = null;
  let statusFlashTimerId = null;

  function createDefaultState() {
    return {
      theme: 'light',
      activeProfileId: null,
      profiles: [],
      customLists: [],
      wordProgress: {},
      telemetryLogs: {}
    };
  }

  let state = createDefaultState();

  let session = {
    active: false,
    onlyDebt: false,
    mode: 2,
    queue: [],
    currentIndex: 0,
    currentItem: null,
    promptShownAt: 0,
    firstKeyAt: 0,
    backspaces: 0,
    verdictPending: false,
    penaltyRemaining: 0,
    resetStreakAfterCorrection: false,
    liveTimerInterval: null
  };

  function pruneUnseenProgress(wordProgressObj) {
    if (!wordProgressObj || typeof wordProgressObj !== 'object') return;
    Object.keys(wordProgressObj).forEach(profId => {
      const map = wordProgressObj[profId];
      if (!map || typeof map !== 'object') return;
      Object.keys(map).forEach(wId => {
        const entry = map[wId];
        if (entry && entry.status === 'UNSEEN' && !entry.debt && !entry.failCount && !entry.flawlessCount) {
          delete map[wId];
        }
      });
    });
  }

  async function loadPersistedState() {
    try {
      if (window.omnispellDesktop && window.omnispellDesktop.loadDatabase) {
        const diskData = await window.omnispellDesktop.loadDatabase();
        if (diskData && Array.isArray(diskData.profiles)) {
          pruneUnseenProgress(diskData.wordProgress);
          state = Object.assign(createDefaultState(), diskData);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }
      } else if (location.protocol.startsWith('http')) {
        const res = await fetch('/api/db').catch(() => null);
        if (res && res.ok) {
          const diskData = await res.json().catch(() => null);
          if (diskData && Array.isArray(diskData.profiles)) {
            pruneUnseenProgress(diskData.wordProgress);
            state = Object.assign(createDefaultState(), diskData);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          }
        }
      }
    } catch (e) {
      console.warn('State init:', e);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (window.omnispellDesktop && window.omnispellDesktop.saveDatabase) {
        window.omnispellDesktop.saveDatabase(state);
      } else if (location.protocol.startsWith('http')) {
        fetch('/api/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state)
        }).catch(() => {});
      }
    } catch (e) {}
  }

  function getActiveProfile() {
    if (!state.profiles || state.profiles.length === 0) {
      return null;
    }
    let prof = state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
    state.activeProfileId = prof.id;
    if (!state.wordProgress[prof.id]) state.wordProgress[prof.id] = {};
    if (!state.telemetryLogs[prof.id]) state.telemetryLogs[prof.id] = [];

    const scoped = getScopedListsForProfile(prof);
    const validIds = new Set(scoped.map(l => l.meta.id));
    prof.activeListIds = (prof.activeListIds || []).filter(id => validIds.has(id));
    if (prof.activeListIds.length === 0 && scoped.length > 0) {
      prof.activeListIds = scoped.map(l => l.meta.id);
    }

    return prof;
  }

  function getAllLists() {
    return [...(window.OMNISPELL_BUILTIN_LISTS || []), ...(state.customLists || [])];
  }

  function getScopedListsForProfile(prof) {
    if (!prof) return [];
    return getAllLists().filter(list => {
      if (!list || !list.meta) return false;
      if (list.meta.language !== prof.language) return false;
      if (!prof.target_test || prof.target_test === 'general' || prof.target_test === 'none') return true;
      return !list.meta.test || list.meta.test === prof.target_test || list.meta.test === 'general' || list.meta.test === 'none';
    });
  }

  function getActiveWordsForProfile(prof) {
    if (!prof) return [];
    const scopedLists = getScopedListsForProfile(prof);
    const activeIds = new Set(prof.activeListIds || []);
    const words = [];
    scopedLists.forEach(list => {
      if (activeIds.has(list.meta.id)) {
        (list.words || []).forEach(w => {
          words.push({ ...w, listId: list.meta.id, listTitle: list.meta.title });
        });
      }
    });
    return words;
  }

  function getSelectedWordsForProfile(prof) {
    if (!prof) return [];
    const scopedLists = getScopedListsForProfile(prof);
    const selectedId = prof.selectedListId || 'ALL';
    if (selectedId !== 'ALL') {
      const targetList = scopedLists.find(l => l.meta.id === selectedId);
      if (targetList && Array.isArray(targetList.words) && targetList.words.length > 0) {
        return targetList.words.map(w => ({ ...w, listId: targetList.meta.id, listTitle: targetList.meta.title }));
      }
    }
    return getActiveWordsForProfile(prof);
  }

  function populateListPickers() {
    const prof = getActiveProfile();
    if (!prof) return;
    const scopedLists = getScopedListsForProfile(prof);
    if (!prof.selectedListId || (prof.selectedListId !== 'ALL' && !scopedLists.some(l => l.meta.id === prof.selectedListId))) {
      prof.selectedListId = scopedLists[0] ? scopedLists[0].meta.id : 'ALL';
    }

    const totalWords = scopedLists.reduce((sum, l) => sum + ((l.words || []).length), 0);

    document.querySelectorAll('.word-list-selector').forEach(select => {
      select.innerHTML = '';
      scopedLists.forEach(list => {
        const opt = document.createElement('option');
        opt.value = list.meta.id;
        opt.textContent = `${list.meta.title} (${(list.words || []).length} words)`;
        if (prof.selectedListId === list.meta.id) opt.selected = true;
        select.appendChild(opt);
      });
      const allOpt = document.createElement('option');
      allOpt.value = 'ALL';
      allOpt.textContent = `All Word Lists (${totalWords} words)`;
      if (prof.selectedListId === 'ALL') allOpt.selected = true;
      select.appendChild(allOpt);
    });
  }

  const DEFAULT_UNSEEN_PROGRESS = Object.freeze({
    status: 'UNSEEN',
    stage: 2,
    debt: 0,
    streak: 0,
    masteryStreak: 0,
    attempts: 0,
    flawlessCount: 0,
    hesitantCount: 0,
    failCount: 0,
    lastError: null
  });

  function peekWordProgress(profId, wordId) {
    const map = state.wordProgress && state.wordProgress[profId];
    if (!map || !map[wordId]) return DEFAULT_UNSEEN_PROGRESS;
    return map[wordId];
  }

  function getWordProgress(profId, wordId) {
    if (!state.wordProgress[profId]) state.wordProgress[profId] = {};
    if (!state.wordProgress[profId][wordId]) {
      state.wordProgress[profId][wordId] = {
        status: 'UNSEEN',
        stage: 2,
        debt: 0,
        streak: 0,
        masteryStreak: 0,
        attempts: 0,
        flawlessCount: 0,
        hesitantCount: 0,
        failCount: 0,
        lastError: null
      };
    }
    const p = state.wordProgress[profId][wordId];
    if (typeof p.masteryStreak !== 'number') {
      p.masteryStreak = 0;
    }
    return p;
  }

  function isWordToMaster(prog) {
    return Boolean(prog && (prog.status === 'IN_DEBT' || (prog.debt && prog.debt > 0)));
  }

  let voiceEngineInitialized = false;

  function initVoiceEngine() {
    if (voiceEngineInitialized) return;
    voiceEngineInitialized = true;
    if ('speechSynthesis' in window) {
      setTimeout(() => {
        try {
          const loadVoices = () => {
            try {
              availableVoices = window.speechSynthesis.getVoices() || [];
              populateVoiceSelector();
            } catch (e) {}
          };
          loadVoices();
          window.speechSynthesis.onvoiceschanged = loadVoices;
        } catch (e) {}
      }, 50);
    }
  }

  function populateVoiceSelector() {
    const select = document.getElementById('set-system-voice-uri');
    if (!select) return;
    const prof = getActiveProfile();
    if (!prof) return;
    select.innerHTML = '<option value="">Auto Default Voice</option>';
    availableVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      if (prof.voice_uri === v.voiceURI) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function speakWord(text, slowMode = false) {
    if (!text) return;
    const prof = getActiveProfile();
    if (!prof) return;
    if (!voiceEngineInitialized) {
      initVoiceEngine();
    }

    const normalRate = Number(prof.voice_rate) || 0.95;
    const slowRate = Number(prof.voice_slow_rate) || 0.72;
    const chosenRate = slowMode ? slowRate : normalRate;

    if ('speechSynthesis' in window && availableVoices.length > 0) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        const targetLang = prof.language === 'en' ? (prof.accent_pref || 'en-GB') : prof.language;
        utter.lang = targetLang;
        utter.rate = chosenRate;

        let chosenVoice = prof.voice_uri ? availableVoices.find(v => v.voiceURI === prof.voice_uri) : null;
        if (!chosenVoice) {
          chosenVoice = availableVoices.find(v => v.localService && v.lang.toLowerCase().replace('_', '-') === targetLang.toLowerCase())
            || availableVoices.find(v => v.lang.toLowerCase().replace('_', '-') === targetLang.toLowerCase())
            || availableVoices.find(v => v.lang.toLowerCase().startsWith(prof.language.toLowerCase()));
        }
        if (chosenVoice) utter.voice = chosenVoice;
        window.speechSynthesis.speak(utter);
        return;
      } catch (e) {}
    }

    const rate = slowMode ? -3 : (normalRate < 0.9 ? -1 : (normalRate > 1.02 ? 1 : 0));
    if (window.omnispellDesktop && window.omnispellDesktop.speakNative) {
      window.omnispellDesktop.speakNative(text, rate);
    } else if (location.protocol.startsWith('http')) {
      fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, rate })
      }).catch(() => {});
    }
  }

  function applyTheme() {
    document.body.classList.toggle('dark-mode', state.theme === 'dark');
    const themeSelect = document.getElementById('set-theme-mode');
    if (themeSelect) {
      themeSelect.value = state.theme === 'dark' ? 'dark' : 'light';
    }
  }

  function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(sec => {
      sec.classList.toggle('active', sec.id === `view-${viewName}`);
    });
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (viewName === 'dashboard') renderDashboard();
    if (viewName === 'lists') renderListsView();
    if (viewName === 'settings') renderSettingsView();
    if (viewName === 'arena') {
      renderArenaView();
    }
  }

  function renderArenaView() {
    const selector = document.getElementById('arena-mode-selector');
    const sessionContainer = document.getElementById('arena-session-container');

    if (session.active) {
      selector.style.display = 'none';
      sessionContainer.style.display = 'block';
    } else {
      selector.style.display = 'block';
      sessionContainer.style.display = 'none';
      populateListPickers();
      const prof = getActiveProfile();
      if (prof) {
        const activeWords = getActiveWordsForProfile(prof);
        const debtCount = activeWords.filter(w => isWordToMaster(peekWordProgress(prof.id, w.id))).length;
        const badge = document.getElementById('arena-debt-count');
        if (badge) badge.textContent = String(debtCount);
      }
    }
  }

  function getInitials(name) {
    const parts = String(name || 'OS').trim().split(/[\s\-_]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name || 'OS').slice(0, 2).toUpperCase();
  }

  function renderDashboard() {
    const prof = getActiveProfile();
    if (!prof) {
      renderLoginScreen();
      return;
    }
    populateListPickers();
    const activeWords = getActiveWordsForProfile(prof);
    const logs = state.telemetryLogs[prof.id] || [];

    const langShort = (prof.language || 'en').toUpperCase();
    const testShort = (prof.target_test && prof.target_test !== 'none' && prof.target_test !== 'general')
      ? ` · ${prof.target_test.toUpperCase()}`
      : '';

    document.getElementById('header-profile-label').textContent = `${prof.name} [${langShort}${testShort}]`;

    let masteredCount = 0;
    let debtWordsCount = 0;
    const mistakeItems = [];

    activeWords.forEach(w => {
      const p = peekWordProgress(prof.id, w.id);
      if (p.status === 'MASTERED' && !isWordToMaster(p)) masteredCount++;
      if (isWordToMaster(p)) {
        debtWordsCount++;
        mistakeItems.push({ wordObj: w, prog: p });
      }
    });

    document.getElementById('stat-mastered-count').textContent = `${masteredCount} / ${activeWords.length}`;
    document.getElementById('stat-debt-count').textContent = `${debtWordsCount}`;
    document.getElementById('btn-debt-count').textContent = `${debtWordsCount}`;
    const arenaDebtEl = document.getElementById('arena-debt-count');
    if (arenaDebtEl) arenaDebtEl.textContent = `${debtWordsCount}`;

    if (logs.length > 0) {
      const flawlessTotal = logs.filter(l => l.verdict === 'FLAWLESS').length;
      document.getElementById('stat-flawless-rate').textContent = `${Math.round((flawlessTotal / logs.length) * 100)}%`;
    } else {
      document.getElementById('stat-flawless-rate').textContent = '0%';
    }

    const tbody = document.getElementById('nemesis-table-body');
    tbody.innerHTML = '';

    mistakeItems.sort((a, b) => (b.prog.failCount || 0) - (a.prog.failCount || 0));

    if (mistakeItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center; padding:20px; color:var(--muted);">
            No words waiting to be mastered. Pick a mode above to start practicing!
          </td>
        </tr>
      `;
    } else {
      mistakeItems.forEach(({ wordObj, prog }) => {
        const streak = prog.masteryStreak || 0;
        const dots = [0, 1, 2].map(i => (i < streak ? '●' : '○')).join(' ');
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><strong class="mono">${escapeHtml(wordObj.word)}</strong></td>
          <td class="mono">${prog.lastError ? `<span class="char-wrong">${escapeHtml(prog.lastError)}</span>` : 'Missed'}</td>
          <td class="mono"><strong>${dots}</strong> &nbsp;(${streak} / 3 consecutive)</td>
          <td><button type="button" class="btn btn-sm drill-single-word-btn" data-word-id="${wordObj.id}">Master (3x)</button></td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.drill-single-word-btn').forEach(btn => {
        btn.addEventListener('click', () => startSession(true, btn.getAttribute('data-word-id'), '4'));
      });
    }
  }

  function runCountdownAndLaunch(onComplete) {
    if (countdownTimerId) {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
    }

    const prof = getActiveProfile();
    const totalSec = (prof && typeof prof.countdown_sec === 'number') ? prof.countdown_sec : 3;
    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');

    if (totalSec <= 0) {
      overlay.style.display = 'none';
      onComplete();
      return;
    }

    let step = 1;
    numEl.textContent = String(step);
    overlay.style.display = 'flex';

    countdownTimerId = setInterval(() => {
      step += 1;
      if (step <= totalSec) {
        numEl.textContent = String(step);
      } else {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
        overlay.style.display = 'none';
        onComplete();
      }
    }, 1000);
  }

  function startSession(onlyDebt = false, prioritizeWordId = null, modeOverride = null) {
    const prof = getActiveProfile();
    if (!prof) return;

    const sourceWords = onlyDebt ? getActiveWordsForProfile(prof) : getSelectedWordsForProfile(prof);
    if (sourceWords.length === 0) {
      alert('Please enable at least one Word List first.');
      switchView('lists');
      return;
    }

    let candidates = sourceWords.map(w => ({ wordObj: w, prog: peekWordProgress(prof.id, w.id) }));
    if (onlyDebt) {
      let filtered = candidates.filter(c => isWordToMaster(c.prog));
      if (prioritizeWordId) {
        const specific = filtered.filter(c => c.wordObj.id === prioritizeWordId);
        if (specific.length > 0) {
          filtered = specific;
        }
      }
      if (filtered.length === 0) {
        alert('You have no Words To Master right now! Pick one of the 3 practice modes.');
        return;
      }

      candidates = [filtered[0]];
    } else {
      const orderMode = prof.word_order || 'shuffle';
      if (orderMode === 'unmastered_first') {
        candidates.sort((a, b) => {
          if (prioritizeWordId) {
            if (a.wordObj.id === prioritizeWordId) return -1;
            if (b.wordObj.id === prioritizeWordId) return 1;
          }
          const rankA = isWordToMaster(a.prog) ? 0 : (a.prog.status === 'MASTERED' ? 2 : 1);
          const rankB = isWordToMaster(b.prog) ? 0 : (b.prog.status === 'MASTERED' ? 2 : 1);
          if (rankA !== rankB) return rankA - rankB;
          return Math.random() - 0.5;
        });
      } else if (orderMode === 'sequential') {
        if (prioritizeWordId) {
          candidates.sort((a, b) => {
            if (a.wordObj.id === prioritizeWordId) return -1;
            if (b.wordObj.id === prioritizeWordId) return 1;
            return 0;
          });
        }
      } else {
        candidates.sort((a, b) => {
          if (prioritizeWordId) {
            if (a.wordObj.id === prioritizeWordId) return -1;
            if (b.wordObj.id === prioritizeWordId) return 1;
          }
          return Math.random() - 0.5;
        });
      }
    }

    const chosenMode = onlyDebt ? 4 : (Number(modeOverride) || 2);
    document.getElementById('arena-mode-override').value = String(chosenMode);

    session.onlyDebt = Boolean(onlyDebt);
    session.mode = chosenMode;
    if (onlyDebt) {
      session.queue = [candidates[0].wordObj];
    } else if (prof.session_size === 'ALL' || Number(prof.session_size) <= 0) {
      session.queue = candidates.map(c => c.wordObj);
    } else {
      session.queue = candidates.slice(0, Number(prof.session_size) || 15).map(c => c.wordObj);
    }
    session.currentIndex = 0;
    session.active = true;

    const modeTitle = MODE_TITLES[String(chosenMode)] || '1. FOLLOW THE SOUND';
    document.getElementById('arena-locked-mode-badge').textContent = `MODE: ${modeTitle}`;

    switchView('arena');

    runCountdownAndLaunch(() => {
      loadArenaCard();
    });
  }

  function buildPatternSlotsHtml(word, revealLast = false) {
    const chars = String(word || '').split('');
    const boxes = chars.map((ch, idx) => {
      if (idx === 0 || (revealLast && idx === chars.length - 1)) {
        return `<span class="slot-box revealed">${escapeHtml(ch.toUpperCase())}</span>`;
      }
      if (ch === ' ' || ch === '-') {
        return `<span class="slot-box revealed">${escapeHtml(ch)}</span>`;
      }
      return `<span class="slot-box">_</span>`;
    }).join('');
    return `${boxes} <span style="margin-left:10px; font-size:12px; font-weight:800; color:var(--muted);">${chars.length} LETTERS</span>`;
  }

  function renderSentenceHtml(sentence, word, filledWord = null) {
    if (!sentence) return '';
    const safeSentence = escapeHtml(sentence);
    const blankHtml = filledWord
      ? `<span class="sentence-blank">${escapeHtml(filledWord)}</span>`
      : `<span class="sentence-blank">_______</span>`;

    if (safeSentence.includes('___')) {
      return safeSentence.replace(/_{2,}/g, blankHtml);
    }
    const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    if (regex.test(safeSentence)) {
      return safeSentence.replace(regex, blankHtml);
    }
    return `${safeSentence} (${blankHtml})`;
  }

  function loadArenaCard() {
    clearInterval(session.liveTimerInterval);
    if (autoAdvanceTimerId) {
      clearTimeout(autoAdvanceTimerId);
      autoAdvanceTimerId = null;
    }
    const prof = getActiveProfile();
    if (!prof) return;

    const hintBtn = document.getElementById('arena-hint-btn');
    if (hintBtn) {
      hintBtn.style.display = (prof.allow_hints === 'no') ? 'none' : 'inline-flex';
    }

    if (session.currentIndex >= session.queue.length) {
      session.active = false;
      renderDashboard();
      switchView('dashboard');
      return;
    }

    const wordObj = session.queue[session.currentIndex];
    const prog = getWordProgress(prof.id, wordObj.id);
    const mode = session.mode;

    session.currentItem = { wordObj, prog, effectiveStage: mode };
    session.promptShownAt = performance.now();
    session.firstKeyAt = 0;
    session.backspaces = 0;
    session.verdictPending = false;
    session.penaltyRemaining = 0;
    session.resetStreakAfterCorrection = false;

    document.getElementById('arena-progress-text').textContent = `${session.currentIndex + 1} / ${session.queue.length}`;

    const promptBox = document.getElementById('arena-prompt-box');
    const defBlock = document.getElementById('arena-definition-block');
    const defText = document.getElementById('arena-definition-text');
    const ctxBlock = document.getElementById('arena-context-block');
    const ctxText = document.getElementById('arena-context-text');
    const patternBlock = document.getElementById('arena-pattern-block');
    const patternText = document.getElementById('arena-pattern-text');
    const clueBlock = document.getElementById('arena-clue-block');
    const clueText = document.getElementById('arena-clue-text');
    const facingTitle = document.getElementById('arena-facing-title');
    const audioControls = document.getElementById('arena-audio-controls');
    const streakPill = document.getElementById('arena-streak-pill');
    const input = document.getElementById('arena-spell-input');
    const submitBtn = document.getElementById('arena-submit-btn');
    const inlineMsg = document.getElementById('inline-feedback-msg');

    promptBox.style.display = 'block';
    defBlock.style.display = 'none';
    ctxBlock.style.display = 'none';
    patternBlock.style.display = 'none';
    clueBlock.classList.remove('visible');
    clueText.textContent = '';
    audioControls.style.display = 'none';
    streakPill.style.display = 'none';

    defText.className = 'prompt-definition';
    defText.textContent = wordObj.definition;

    ctxText.innerHTML = renderSentenceHtml(wordObj.context_sentence, wordObj.word, null)
      || `<span class="sentence-blank">_______</span> - ${escapeHtml(wordObj.definition)}`;

    if (mode === 2) {

      promptBox.style.display = 'none';
      audioControls.style.display = 'flex';
      facingTitle.textContent = '1. FOLLOW THE SOUND - LISTEN & SPELL';
      input.placeholder = 'Type the word you heard...';
      speakWord(wordObj.word, false);
    } else if (mode === 3) {

      defBlock.style.display = 'block';
      patternBlock.style.display = 'block';
      patternText.innerHTML = buildPatternSlotsHtml(wordObj.word, false);
      facingTitle.textContent = '2. GUESS THE WORD FROM MEANING & PATTERN';
      input.placeholder = `Starts with "${wordObj.word.charAt(0).toUpperCase()}" (${wordObj.word.length} letters)...`;
    } else if (mode === 1) {

      ctxBlock.style.display = 'block';
      defBlock.style.display = 'block';
      defText.className = 'prompt-definition sub-meaning';
      defText.textContent = `Meaning: ${wordObj.definition}`;
      patternBlock.style.display = 'block';
      patternText.innerHTML = buildPatternSlotsHtml(wordObj.word, false);
      facingTitle.textContent = '3. COMPLETE THE SENTENCE BLANK';
      input.placeholder = `Type the missing word (${wordObj.word.charAt(0).toUpperCase()}..., ${wordObj.word.length} letters)...`;
    } else if (mode === 4) {

      promptBox.style.display = 'none';
      audioControls.style.display = 'flex';
      streakPill.style.display = 'inline-block';
      const curStreak = prog.masteryStreak || 0;
      streakPill.textContent = `CONSECUTIVE: ${curStreak} / 3`;
      facingTitle.textContent = `MASTER WORD - LISTEN & SPELL 3 TIMES IN A ROW (${curStreak} / 3)`;
      input.placeholder = `Attempt ${curStreak + 1} of 3 consecutive - Type the word you heard...`;
      speakWord(wordObj.word, false);
    }

    input.value = '';
    input.readOnly = false;
    input.className = 'spell-input';

    submitBtn.textContent = 'Check [Enter]';
    submitBtn.className = 'btn';

    inlineMsg.className = 'mono inline-status-msg';
    inlineMsg.textContent = 'Thinking: 0.0s';

    input.focus();

    session.liveTimerInterval = setInterval(() => {
      if (session.verdictPending || session.firstKeyAt) return;
      const sec = ((performance.now() - session.promptShownAt) / 1000).toFixed(1);
      inlineMsg.textContent = `Thinking: ${sec}s`;
    }, 100);
  }

  function evaluateAttempt(rawTyped) {
    if (!session.currentItem) return;

    const prof = getActiveProfile();
    if (!prof) return;
    const { wordObj, prog, effectiveStage } = session.currentItem;
    const input = document.getElementById('arena-spell-input');
    const submitBtn = document.getElementById('arena-submit-btn');
    const inlineMsg = document.getElementById('inline-feedback-msg');
    const streakPill = document.getElementById('arena-streak-pill');
    const facingTitle = document.getElementById('arena-facing-title');
    const typed = (rawTyped || '').trim();
    const target = wordObj.word.trim();

    if (session.verdictPending && session.penaltyRemaining > 0) {
      if (typed.toLowerCase() === target.toLowerCase()) {
        session.penaltyRemaining = 0;

        if (session.onlyDebt) {
          session.verdictPending = false;
          session.firstKeyAt = 0;
          session.backspaces = 0;
          session.promptShownAt = performance.now();

          input.value = '';
          input.readOnly = false;
          input.className = 'spell-input';
          input.placeholder = `Attempt 1 of 3 - Type the word you heard...`;
          submitBtn.textContent = 'Check [Enter]';
          submitBtn.className = 'btn';
          inlineMsg.className = 'mono inline-status-msg';
          inlineMsg.textContent = 'Fresh start (0 / 3) - listen and spell it 3 times in a row!';
          streakPill.textContent = `CONSECUTIVE: 0 / 3`;
          facingTitle.textContent = `MASTER WORD - LISTEN & SPELL 3 TIMES IN A ROW (0 / 3)`;
          speakWord(target, false);
          input.focus();
          return;
        }

        input.value = target;
        input.readOnly = true;
        input.className = 'spell-input state-correct';
        submitBtn.textContent = 'Next Word [Enter] →';
        submitBtn.className = 'btn state-correct';
        inlineMsg.className = 'mono inline-status-msg text-correct';
        inlineMsg.textContent = `Nice! Added to Words To Master. Press Enter for the next word.`;
      } else {
        input.value = '';
        input.placeholder = `Type "${target}" to continue...`;
        inlineMsg.className = 'mono inline-status-msg text-wrong';
        inlineMsg.textContent = `Look closely and type "${target}" above to continue.`;
        input.focus();
      }
      return;
    }

    if (session.verdictPending && session.penaltyRemaining <= 0) {
      advanceToNextCard();
      return;
    }

    clearInterval(session.liveTimerInterval);

    const now = performance.now();
    const ttftMs = session.firstKeyAt ? Math.round(session.firstKeyAt - session.promptShownAt) : Math.round(now - session.promptShownAt);
    const isExactMatch = typed.toLowerCase() === target.toLowerCase();
    const isSlowOrEdited = ttftMs > prof.ttft_threshold_ms || session.backspaces > 0;

    let verdict = 'FLAWLESS';
    let debtDelta = 0;

    if (!isExactMatch) {
      verdict = 'MISSPELLED';
      debtDelta = 3;
      prog.debt = 3;
      prog.streak = 0;
      prog.masteryStreak = 0; // Reset consecutive 3x counter to 0!
      prog.failCount = (prog.failCount || 0) + 1;
      prog.lastError = typed || '[empty]';
      prog.status = 'IN_DEBT';
    } else {
      verdict = isSlowOrEdited ? 'HESITANT' : 'FLAWLESS';
      if (isSlowOrEdited) {
        prog.hesitantCount = (prog.hesitantCount || 0) + 1;
      } else {
        prog.flawlessCount = (prog.flawlessCount || 0) + 1;
      }
      prog.streak = (prog.streak || 0) + 1;

      if (session.onlyDebt) {
        prog.masteryStreak = (prog.masteryStreak || 0) + 1;
        if (prog.masteryStreak >= 3) {
          prog.debt = 0;
          prog.status = 'MASTERED';
          debtDelta = -3;
        }
      } else if (!isWordToMaster(prog)) {
        prog.status = 'MASTERED';
      }
    }

    state.telemetryLogs[prof.id].unshift({
      timestamp: new Date().toISOString(),
      wordId: wordObj.id,
      word: wordObj.word,
      typedInput: typed,
      stage: effectiveStage,
      verdict,
      ttftMs,
      backspaces: session.backspaces,
      debtDelta
    });

    saveState();

    if (effectiveStage === 2 || effectiveStage === 4) {
      speakWord(wordObj.word, false);
    }

    if (session.onlyDebt) {
      if (isExactMatch) {
        const curStreak = prog.masteryStreak || 0;
        streakPill.textContent = `CONSECUTIVE: ${curStreak} / 3`;
        facingTitle.textContent = `MASTER WORD - LISTEN & SPELL 3 TIMES IN A ROW (${curStreak} / 3)`;

        if (curStreak < 3) {

          session.verdictPending = false;
          session.firstKeyAt = 0;
          session.backspaces = 0;
          session.promptShownAt = performance.now();

          input.value = '';
          input.readOnly = false;
          input.className = 'spell-input';
          input.placeholder = `Attempt ${curStreak + 1} of 3 consecutive - Type the word you heard...`;
          inlineMsg.className = 'mono inline-status-msg text-correct';
          inlineMsg.textContent = `✓ Correct (${curStreak} / 3)! Keep going - ${3 - curStreak} more in a row to master it.`;
          input.focus();
          return;
        } else {

          session.verdictPending = true;
          session.penaltyRemaining = 0;
          input.value = target;
          input.readOnly = true;
          input.className = 'spell-input state-correct';
          submitBtn.textContent = 'Finish [Enter] →';
          submitBtn.className = 'btn state-correct';
          inlineMsg.className = 'mono inline-status-msg text-correct';
          inlineMsg.textContent = `✓ 3 / 3 Consecutive! "${target}" is now Mastered! Press Enter to finish.`;
          return;
        }
      } else {

        session.verdictPending = true;
        session.penaltyRemaining = 1;
        streakPill.textContent = `CONSECUTIVE: 0 / 3`;
        facingTitle.textContent = `MISTAKE - STREAK RESET TO 0 / 3`;

        input.className = 'spell-input state-wrong';
        input.value = '';
        input.placeholder = `Type "${target}" to reset and try again...`;

        submitBtn.textContent = 'Continue [Enter]';
        submitBtn.className = 'btn state-wrong';

        inlineMsg.className = 'mono inline-status-msg text-wrong';
        inlineMsg.textContent = `Oops! It's spelled "${target}" - type it once above to start a fresh 3-in-a-row.`;
        input.focus();
        return;
      }
    }

    session.verdictPending = true;

    if (effectiveStage === 1 && wordObj.context_sentence) {
      document.getElementById('arena-context-text').innerHTML =
        renderSentenceHtml(wordObj.context_sentence, wordObj.word, target);
    }

    if (isExactMatch) {
      input.value = target;
      input.readOnly = true;
      input.className = 'spell-input state-correct';

      submitBtn.textContent = 'Next Word [Enter] →';
      submitBtn.className = 'btn state-correct';

      inlineMsg.className = 'mono inline-status-msg text-correct';
      const timeSec = (ttftMs / 1000).toFixed(1);
      inlineMsg.textContent = `✓ Spot on (${timeSec}s) - ${wordObj.definition}`;

      if (prof.auto_advance === 'auto') {
        if (autoAdvanceTimerId) clearTimeout(autoAdvanceTimerId);
        autoAdvanceTimerId = setTimeout(() => {
          autoAdvanceTimerId = null;
          if (session.active && session.verdictPending && session.penaltyRemaining <= 0) {
            advanceToNextCard();
          }
        }, 850);
      }
    } else {

      session.penaltyRemaining = 1;

      input.className = 'spell-input state-wrong';
      input.value = '';
      input.placeholder = `Type "${target}" to continue...`;

      submitBtn.textContent = 'Continue [Enter]';
      submitBtn.className = 'btn state-wrong';

      inlineMsg.className = 'mono inline-status-msg text-wrong';
      inlineMsg.textContent = `Almost! It's spelled "${target}" - type it once above to continue.`;
      input.focus();
    }
  }

  function advanceToNextCard() {
    if (autoAdvanceTimerId) {
      clearTimeout(autoAdvanceTimerId);
      autoAdvanceTimerId = null;
    }
    if (!session.verdictPending || session.penaltyRemaining > 0) return;
    session.currentIndex += 1;
    loadArenaCard();
  }

  function renderListsView() {
    const prof = getActiveProfile();
    if (!prof) return;
    const scopedLists = getScopedListsForProfile(prof);
    const activeSet = new Set(prof.activeListIds || []);
    const langLabel = LANGUAGE_LABELS[prof.language] || prof.language.toUpperCase();

    document.getElementById('lists-view-heading').textContent = `${langLabel} Word Lists`;

    const grid = document.getElementById('scoped-lists-grid');
    grid.innerHTML = '';

    scopedLists.forEach(list => {
      const isEnabled = activeSet.has(list.meta.id);
      const words = list.words || [];
      const card = document.createElement('div');
      card.className = 'list-card';
      card.innerHTML = `
        <div>
          <div class="list-meta">
            <span>${words.length} Words</span>
            <span>${isEnabled ? 'ACTIVE' : 'OFF'}</span>
          </div>
          <div class="list-title">${escapeHtml(list.meta.title)}</div>
          <p class="list-desc">${escapeHtml(list.meta.description || '')}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn-sm toggle-list-active-btn ${isEnabled ? 'btn-outline' : ''}" data-list-id="${list.meta.id}">
            ${isEnabled ? 'Disable' : 'Enable'}
          </button>
          <button type="button" class="btn btn-outline btn-sm inspect-list-btn" data-list-id="${list.meta.id}">
            View Words
          </button>
        </div>
      `;
      grid.appendChild(card);
    });

    grid.querySelectorAll('.toggle-list-active-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const listId = btn.getAttribute('data-list-id');
        const idx = prof.activeListIds.indexOf(listId);
        if (idx >= 0) prof.activeListIds.splice(idx, 1);
        else prof.activeListIds.push(listId);
        saveState();
        renderListsView();
      });
    });

    grid.querySelectorAll('.inspect-list-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        inspectedListId = btn.getAttribute('data-list-id');
        renderListInspector();
      });
    });

    if (inspectedListId) renderListInspector();
  }

  function renderListInspector() {
    const section = document.getElementById('list-inspector-section');
    const list = getAllLists().find(l => l.meta.id === inspectedListId);
    if (!list) {
      section.style.display = 'none';
      return;
    }
    const prof = getActiveProfile();
    if (!prof) return;
    section.style.display = 'block';
    document.getElementById('inspector-list-title').textContent = `${list.meta.title} (${list.words.length} Words)`;

    const tbody = document.getElementById('inspector-words-tbody');
    tbody.innerHTML = '';

    list.words.forEach(w => {
      const p = peekWordProgress(prof.id, w.id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><button type="button" class="btn btn-outline btn-sm speak-row-btn" data-word="${escapeHtml(w.word)}">Hear</button></td>
        <td><strong class="mono">${escapeHtml(w.word)}</strong></td>
        <td>${escapeHtml(w.definition)}</td>
        <td class="mono">${isWordToMaster(p) ? `TO MASTER (${p.masteryStreak || 0}/3)` : p.status}</td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.speak-row-btn').forEach(btn => {
      btn.addEventListener('click', () => speakWord(btn.getAttribute('data-word'), false));
    });
  }

  function addBuilderWordRow() {
    const container = document.getElementById('custom-words-builder-rows');
    const row = document.createElement('div');
    row.className = 'builder-word-row';
    row.style.cssText = 'display:grid; grid-template-columns: 1fr 2fr auto; gap:8px; margin-bottom:8px;';
    row.innerHTML = `
      <input type="text" class="b-word" placeholder="Word *" required style="padding:8px; border:2px solid var(--fg); background:var(--bg); color:var(--fg);">
      <input type="text" class="b-def" placeholder="Definition *" required style="padding:8px; border:2px solid var(--fg); background:var(--bg); color:var(--fg);">
      <button type="button" class="btn btn-outline btn-sm remove-row-btn">✕</button>
    `;
    row.querySelector('.remove-row-btn').addEventListener('click', () => {
      if (container.children.length > 1) row.remove();
    });
    container.appendChild(row);
  }

  function handleImportListFile(file) {
    if (!file) return;
    const prof = getActiveProfile();
    if (!prof) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        let newList = null;
        if (file.name.toLowerCase().endsWith('.json')) {
          const parsed = JSON.parse(text);
          if (!parsed.meta || !parsed.meta.language || !Array.isArray(parsed.words)) {
            throw new Error('Invalid JSON list format.');
          }
          if (parsed.meta.language.toLowerCase() !== prof.language.toLowerCase()) {
            throw new Error(`Cannot import a ${parsed.meta.language.toUpperCase()} list into an ${prof.language.toLowerCase()} profile.`);
          }
          parsed.words.forEach((w, idx) => {
            if (!w.word || !w.definition) throw new Error(`Word #${idx + 1} is missing word or definition.`);
            if (!w.id) w.id = `w_custom_${Date.now()}_${idx}`;
          });
          parsed.meta.id = parsed.meta.id || `custom_${Date.now()}`;
          newList = parsed;
        } else {
          const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
          const words = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(s => s.replace(/^"|"$/g, '').trim());
            if (!cols[0] || !cols[1]) throw new Error(`Row ${i + 1} needs both word and definition.`);
            words.push({
              id: `w_csv_${Date.now()}_${i}`,
              word: cols[0],
              definition: cols[1],
              part_of_speech: cols[2] || 'word',
              context_sentence: cols[3] || '',
              trap_note: cols[4] || ''
            });
          }
          newList = {
            meta: {
              id: `custom_csv_${Date.now()}`,
              title: file.name.replace(/\.csv$/i, ''),
              description: `${words.length} imported words`,
              language: prof.language,
              test: prof.target_test || 'general'
            },
            words
          };
        }
        state.customLists.push(newList);
        prof.activeListIds.push(newList.meta.id);
        saveState();
        renderListsView();
      } catch (err) {
        alert(err.message);
      }
    };
    reader.readAsText(file);
  }

  function flashSettingsSaved(message = '✓ All Settings Saved') {
    const pill = document.getElementById('settings-save-status');
    if (!pill) return;
    pill.textContent = message;
    pill.classList.add('flash');
    if (statusFlashTimerId) clearTimeout(statusFlashTimerId);
    statusFlashTimerId = setTimeout(() => {
      pill.textContent = '✓ Saved';
      pill.classList.remove('flash');
    }, 1800);
  }

  function renderSettingsView() {
    const prof = getActiveProfile();
    if (!prof) return;
    const sizeSelect = document.getElementById('set-session-size');
    const rawSize = String(prof.session_size || '15');
    if ([...sizeSelect.options].some(o => o.value === rawSize)) {
      sizeSelect.value = rawSize;
    } else {
      sizeSelect.value = 'ALL';
    }
    document.getElementById('set-countdown-sec').value = String(typeof prof.countdown_sec === 'number' ? prof.countdown_sec : 3);
    document.getElementById('set-word-order').value = prof.word_order || 'shuffle';
    document.getElementById('set-auto-advance').value = prof.auto_advance || 'manual';
    document.getElementById('set-allow-hints').value = prof.allow_hints || 'yes';
    document.getElementById('set-ttft-ms').value = prof.ttft_threshold_ms || 2500;
    document.getElementById('set-retype-count').value = String(prof.retype_penalty_count || 1);

    document.getElementById('set-voice-accent').value = prof.accent_pref || 'en-GB';
    document.getElementById('set-voice-rate').value = String(prof.voice_rate || 0.95);
    document.getElementById('set-voice-slow-rate').value = String(prof.voice_slow_rate || 0.72);
    initVoiceEngine();
    populateVoiceSelector();

    document.getElementById('set-prof-name').value = prof.name || '';
    document.getElementById('set-prof-test').value = prof.target_test || 'none';
    document.getElementById('set-prof-password').value = prof.password || '';
    document.getElementById('set-theme-mode').value = state.theme === 'dark' ? 'dark' : 'light';

    const clearBtn = document.getElementById('clear-mistakes-btn');
    if (clearBtn) {
      clearBtn.dataset.confirm = '';
      clearBtn.textContent = 'Clear Mistakes';
    }
    const resetBtn = document.getElementById('reset-profile-progress-btn');
    if (resetBtn) {
      resetBtn.dataset.confirm = '';
      resetBtn.textContent = 'Reset All Progress';
    }
  }

  function saveSettingsFromForm(customMessage = '✓ Saved') {
    const prof = getActiveProfile();
    if (!prof) return;

    const chosenSize = document.getElementById('set-session-size').value;
    prof.session_size = chosenSize === 'ALL' ? 'ALL' : (Number(chosenSize) || 15);
    prof.countdown_sec = Number(document.getElementById('set-countdown-sec').value);
    if (Number.isNaN(prof.countdown_sec)) prof.countdown_sec = 3;
    prof.word_order = document.getElementById('set-word-order').value || 'shuffle';
    prof.auto_advance = document.getElementById('set-auto-advance').value || 'manual';
    prof.allow_hints = document.getElementById('set-allow-hints').value || 'yes';
    prof.ttft_threshold_ms = Number(document.getElementById('set-ttft-ms').value) || 2500;
    prof.retype_penalty_count = Number(document.getElementById('set-retype-count').value) || 1;

    prof.accent_pref = document.getElementById('set-voice-accent').value || 'en-GB';
    prof.voice_uri = document.getElementById('set-system-voice-uri').value || '';
    prof.voice_rate = Number(document.getElementById('set-voice-rate').value) || 0.95;
    prof.voice_slow_rate = Number(document.getElementById('set-voice-slow-rate').value) || 0.72;

    const newName = document.getElementById('set-prof-name').value.trim();
    if (newName) prof.name = newName;
    prof.target_test = document.getElementById('set-prof-test').value || 'none';
    prof.password = document.getElementById('set-prof-password').value;

    const chosenTheme = document.getElementById('set-theme-mode').value || 'light';
    if (state.theme !== chosenTheme) {
      state.theme = chosenTheme;
      applyTheme();
    }

    const langShort = (prof.language || 'en').toUpperCase();
    const testShort = (prof.target_test && prof.target_test !== 'none' && prof.target_test !== 'general')
      ? ` · ${prof.target_test.toUpperCase()}`
      : '';
    document.getElementById('header-profile-label').textContent = `${prof.name} [${langShort}${testShort}]`;

    populateListPickers();
    saveState();
    flashSettingsSaved(customMessage);
  }

  function renderLoginScreen() {
    document.getElementById('profile-login-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display = 'none';

    const grid = document.getElementById('login-profiles-grid');
    grid.innerHTML = '';

    (state.profiles || []).forEach(p => {
      const langShort = (p.language || 'en').toUpperCase();
      const testShort = (p.target_test && p.target_test !== 'none' && p.target_test !== 'general')
        ? ` · ${p.target_test.toUpperCase()}`
        : '';

      const card = document.createElement('div');
      card.className = 'login-profile-card';
      card.innerHTML = `
        <button type="button" class="login-delete-btn" title="Delete Profile">✕</button>
        <div>
          <div class="login-avatar-box">${escapeHtml(getInitials(p.name))}</div>
          <div class="login-card-name">${escapeHtml(p.name)}</div>
          <div class="login-card-meta">${langShort}${testShort}</div>
        </div>
        <div class="login-card-footer">
          <span>Log In</span>
          <span>→</span>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.login-delete-btn')) return;
        openPasswordLoginModal(p.id);
      });

      const delBtn = card.querySelector('.login-delete-btn');
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteProfileModal(p.id);
      });

      grid.appendChild(card);
    });

    const addCard = document.createElement('div');
    addCard.className = 'login-profile-card login-add-card';
    addCard.innerHTML = `
      <div class="login-plus-icon">+</div>
      <div class="login-card-name" style="font-size:15px;">New Profile</div>
    `;
    addCard.addEventListener('click', () => {
      document.getElementById('create-profile-form').reset();
      document.getElementById('new-prof-test').value = 'none';
      document.getElementById('create-profile-modal').classList.add('open');
      setTimeout(() => document.getElementById('new-prof-name').focus(), 50);
    });
    grid.appendChild(addCard);
  }

  function openDeleteProfileModal(profileId) {
    const prof = (state.profiles || []).find(p => p.id === profileId);
    if (!prof) return;
    pendingDeleteProfileId = profileId;

    document.getElementById('delete-modal-profile-title').textContent = `Delete "${prof.name}"`;
    document.getElementById('delete-modal-desc').textContent =
      `Are you sure you want to permanently delete profile "${prof.name}" and its progress?`;

    const passField = document.getElementById('delete-password-field');
    const passInput = document.getElementById('delete-password-input');
    const passError = document.getElementById('delete-password-error');

    passInput.value = '';
    passError.style.display = 'none';

    if (prof.password) {
      passField.style.display = 'block';
    } else {
      passField.style.display = 'none';
    }

    document.getElementById('delete-profile-modal').classList.add('open');
    if (prof.password) {
      setTimeout(() => passInput.focus(), 50);
    }
  }

  function openPasswordLoginModal(profileId) {
    const prof = (state.profiles || []).find(p => p.id === profileId);
    if (!prof) return;
    pendingLoginProfileId = profileId;

    document.getElementById('login-modal-profile-title').textContent = prof.name;
    document.getElementById('login-password-label').textContent = prof.password
      ? 'Password'
      : 'Set a password for this profile';
    document.getElementById('login-password-error').style.display = 'none';

    const passInput = document.getElementById('login-password-input');
    passInput.value = '';
    document.getElementById('password-login-modal').classList.add('open');
    setTimeout(() => passInput.focus(), 50);
  }

  function loginToProfile(profileId) {
    state.activeProfileId = profileId;
    session.active = false;
    saveState();

    document.getElementById('create-profile-modal').classList.remove('open');
    document.getElementById('password-login-modal').classList.remove('open');
    document.getElementById('delete-profile-modal').classList.remove('open');
    document.getElementById('profile-login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display = 'block';
    switchView('dashboard');
  }

  function bindEvents() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    document.getElementById('brand-home-btn').addEventListener('click', () => switchView('dashboard'));

    const toggleTheme = () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      saveState();
    };
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
    document.getElementById('login-theme-toggle-btn').addEventListener('click', toggleTheme);

    document.querySelectorAll('.word-list-selector').forEach(select => {
      select.addEventListener('change', (e) => {
        const prof = getActiveProfile();
        if (!prof) return;
        prof.selectedListId = e.target.value;
        saveState();
        populateListPickers();
      });
    });

    document.querySelectorAll('.start-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => startSession(false, null, btn.getAttribute('data-mode')));
    });

    document.getElementById('start-debt-session-btn').addEventListener('click', () => startSession(true, null, '4'));
    const arenaDebtBtn = document.getElementById('arena-start-debt-btn');
    if (arenaDebtBtn) {
      arenaDebtBtn.addEventListener('click', () => startSession(true, null, '4'));
    }

    document.getElementById('arena-exit-btn').addEventListener('click', () => {
      session.active = false;
      clearInterval(session.liveTimerInterval);
      if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
      }
      document.getElementById('countdown-overlay').style.display = 'none';
      renderArenaView();
      renderDashboard();
    });

    document.getElementById('arena-play-audio-btn').addEventListener('click', () => {
      if (session.currentItem && (session.mode === 2 || session.mode === 4)) {
        speakWord(session.currentItem.wordObj.word, false);
      }
      document.getElementById('arena-spell-input').focus();
    });

    document.getElementById('arena-slow-audio-btn').addEventListener('click', () => {
      if (session.currentItem && (session.mode === 2 || session.mode === 4)) {
        speakWord(session.currentItem.wordObj.word, true);
      }
      document.getElementById('arena-spell-input').focus();
    });

    document.getElementById('arena-hint-btn').addEventListener('click', () => {
      if (!session.currentItem) return;
      const w = session.currentItem.wordObj;
      const clueBlock = document.getElementById('arena-clue-block');
      const clueText = document.getElementById('arena-clue-text');

      if (session.mode === 2 || session.mode === 4) {

        clueText.textContent = w.definition;
      } else {

        const patternText = document.getElementById('arena-pattern-text');
        if (patternText) {
          patternText.innerHTML = buildPatternSlotsHtml(w.word, true);
        }
        clueText.textContent = w.trap_note || w.syllables || `Starts with "${w.word[0].toUpperCase()}" and ends with "${w.word[w.word.length - 1].toUpperCase()}"`;
      }

      clueBlock.classList.add('visible');
      document.getElementById('arena-spell-input').focus();
    });

    const spellInput = document.getElementById('arena-spell-input');
    spellInput.addEventListener('keydown', (e) => {
      if (session.verdictPending) return;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        session.backspaces += 1;
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !session.firstKeyAt) {
        session.firstKeyAt = performance.now();
      }
    });

    document.getElementById('arena-spell-form').addEventListener('submit', (e) => {
      e.preventDefault();
      evaluateAttempt(spellInput.value);
    });

    document.getElementById('toggle-create-list-btn').addEventListener('click', () => {
      const panel = document.getElementById('create-list-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      const rows = document.getElementById('custom-words-builder-rows');
      if (rows.children.length === 0) addBuilderWordRow();
    });

    document.getElementById('cancel-create-list-btn').addEventListener('click', () => {
      document.getElementById('create-list-panel').style.display = 'none';
    });

    document.getElementById('add-builder-word-row-btn').addEventListener('click', addBuilderWordRow);

    document.getElementById('create-list-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const prof = getActiveProfile();
      if (!prof) return;
      const title = document.getElementById('new-list-title').value.trim();
      const desc = document.getElementById('new-list-desc').value.trim();
      const words = [];
      document.querySelectorAll('#custom-words-builder-rows .builder-word-row').forEach((r, idx) => {
        const w = r.querySelector('.b-word').value.trim();
        const d = r.querySelector('.b-def').value.trim();
        if (w && d) words.push({ id: `w_${Date.now()}_${idx}`, word: w, definition: d });
      });
      if (words.length === 0) return;
      const newList = {
        meta: { id: `custom_${Date.now()}`, title, description: desc, language: prof.language, test: prof.target_test || 'general' },
        words
      };
      state.customLists.push(newList);
      prof.activeListIds.push(newList.meta.id);
      saveState();
      document.getElementById('create-list-form').reset();
      document.getElementById('create-list-panel').style.display = 'none';
      renderListsView();
    });

    document.getElementById('download-template-csv-btn').addEventListener('click', () => {
      const csv = 'word,definition,part_of_speech,context_sentence,trap_note\n"accommodation","A place to live or stay.","noun","The university guarantees _____ for students.","Double c, double m"';
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'omnispell_template.csv';
      a.click();
    });

    document.getElementById('import-list-file-input').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImportListFile(e.target.files[0]);
        e.target.value = '';
      }
    });

    document.getElementById('inspector-close-btn').addEventListener('click', () => {
      inspectedListId = null;
      document.getElementById('list-inspector-section').style.display = 'none';
    });

    document.getElementById('inspector-add-word-toggle-btn').addEventListener('click', () => {
      const form = document.getElementById('quick-add-word-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('quick-add-word-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const list = getAllLists().find(l => l.meta.id === inspectedListId);
      if (!list) return;
      list.words.push({
        id: `w_add_${Date.now()}`,
        word: document.getElementById('qa-word').value.trim(),
        definition: document.getElementById('qa-def').value.trim(),
        context_sentence: document.getElementById('qa-context').value.trim()
      });
      saveState();
      document.getElementById('quick-add-word-form').reset();
      document.getElementById('quick-add-word-form').style.display = 'none';
      renderListInspector();
      renderListsView();
    });

    const settingsForm = document.getElementById('settings-calibration-form');
    settingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettingsFromForm('✓ Changes Saved');
    });

    settingsForm.querySelectorAll('select, input[type="number"]').forEach(el => {
      el.addEventListener('change', () => saveSettingsFromForm('✓ Auto-Saved'));
    });

    ['set-prof-name', 'set-prof-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => saveSettingsFromForm('✓ Profile Updated'));
      }
    });

    const saveAllBtn = document.getElementById('save-all-settings-btn');
    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', () => saveSettingsFromForm('✓ All Changes Saved'));
    }

    document.getElementById('test-voice-btn').addEventListener('click', () => {
      saveSettingsFromForm('✓ Voice Ready');
      const sample = (document.getElementById('set-voice-sample-input').value || '').trim() || 'accommodation';
      speakWord(sample, false);
    });

    const slowVoiceBtn = document.getElementById('test-voice-slow-btn');
    if (slowVoiceBtn) {
      slowVoiceBtn.addEventListener('click', () => {
        saveSettingsFromForm('✓ Slow Voice Ready');
        const sample = (document.getElementById('set-voice-sample-input').value || '').trim() || 'accommodation';
        speakWord(sample, true);
      });
    }

    const exportBackupBtn = document.getElementById('export-backup-btn');
    if (exportBackupBtn) {
      exportBackupBtn.addEventListener('click', () => {
        const json = JSON.stringify(state, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = URL.createObjectURL(blob);
        a.download = `omnispell_backup_${dateStr}.json`;
        a.click();
        flashSettingsSaved('✓ Backup Exported');
      });
    }

    const importBackupInput = document.getElementById('import-backup-input');
    if (importBackupInput) {
      importBackupInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const parsed = JSON.parse(ev.target.result);
            if (!parsed || !Array.isArray(parsed.profiles)) {
              throw new Error('Invalid OMNISPELL backup file.');
            }
            state = Object.assign(createDefaultState(), parsed);
            saveState();
            applyTheme();
            renderSettingsView();
            renderDashboard();
            flashSettingsSaved('✓ Backup Restored!');
          } catch (err) {
            flashSettingsSaved('✕ Invalid Backup File');
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      });
    }

    const clearMistakesBtn = document.getElementById('clear-mistakes-btn');
    if (clearMistakesBtn) {
      clearMistakesBtn.addEventListener('click', () => {
        const prof = getActiveProfile();
        if (!prof) return;
        if (clearMistakesBtn.dataset.confirm !== 'yes') {
          clearMistakesBtn.dataset.confirm = 'yes';
          clearMistakesBtn.textContent = 'Confirm Clear Mistakes?';
          return;
        }
        const progMap = state.wordProgress[prof.id] || {};
        Object.keys(progMap).forEach(wordId => {
          const p = progMap[wordId];
          if (p && (p.status === 'IN_DEBT' || p.debt > 0)) {
            p.debt = 0;
            p.masteryStreak = 0;
            p.status = 'UNSEEN';
          }
        });
        saveState();
        clearMistakesBtn.dataset.confirm = '';
        clearMistakesBtn.textContent = 'Clear Mistakes Only';
        renderDashboard();
        flashSettingsSaved('✓ Mistakes Queue Cleared');
      });
    }

    const resetBtn = document.getElementById('reset-profile-progress-btn');
    resetBtn.addEventListener('click', () => {
      const prof = getActiveProfile();
      if (!prof) return;
      if (resetBtn.dataset.confirm !== 'yes') {
        resetBtn.dataset.confirm = 'yes';
        resetBtn.textContent = 'Confirm Full Reset?';
        return;
      }
      state.wordProgress[prof.id] = {};
      state.telemetryLogs[prof.id] = [];
      saveState();
      resetBtn.dataset.confirm = '';
      resetBtn.textContent = 'Reset All Progress';
      renderDashboard();
      flashSettingsSaved('✓ All Progress Reset');
    });

    document.getElementById('logout-profile-btn').addEventListener('click', () => {
      session.active = false;
      clearInterval(session.liveTimerInterval);
      if (countdownTimerId) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
      }
      document.getElementById('countdown-overlay').style.display = 'none';
      renderLoginScreen();
    });

    const closeCreate = () => document.getElementById('create-profile-modal').classList.remove('open');
    document.getElementById('close-create-profile-modal-btn').addEventListener('click', closeCreate);
    document.getElementById('cancel-new-profile-btn').addEventListener('click', closeCreate);

    const closePass = () => document.getElementById('password-login-modal').classList.remove('open');
    document.getElementById('close-password-modal-btn').addEventListener('click', closePass);
    document.getElementById('cancel-password-modal-btn').addEventListener('click', closePass);

    const closeDelete = () => document.getElementById('delete-profile-modal').classList.remove('open');
    document.getElementById('close-delete-modal-btn').addEventListener('click', closeDelete);
    document.getElementById('cancel-delete-modal-btn').addEventListener('click', closeDelete);

    document.getElementById('delete-profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const prof = (state.profiles || []).find(p => p.id === pendingDeleteProfileId);
      if (!prof) return;
      if (prof.password) {
        const entered = document.getElementById('delete-password-input').value;
        if (entered !== prof.password) {
          document.getElementById('delete-password-error').style.display = 'block';
          return;
        }
      }
      state.profiles = state.profiles.filter(item => item.id !== prof.id);
      delete state.wordProgress[prof.id];
      delete state.telemetryLogs[prof.id];
      if (state.activeProfileId === prof.id) {
        state.activeProfileId = state.profiles[0] ? state.profiles[0].id : null;
      }
      saveState();
      closeDelete();
      renderLoginScreen();
    });

    document.getElementById('password-login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const prof = (state.profiles || []).find(p => p.id === pendingLoginProfileId);
      if (!prof) return;
      const entered = document.getElementById('login-password-input').value;
      if (!prof.password) {
        prof.password = entered;
        saveState();
        loginToProfile(prof.id);
      } else if (entered === prof.password) {
        loginToProfile(prof.id);
      } else {
        document.getElementById('login-password-error').style.display = 'block';
      }
    });

    document.getElementById('create-profile-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('new-prof-name').value.trim();
      const password = document.getElementById('new-prof-password').value;
      const language = document.getElementById('new-prof-lang').value;
      const target_test = document.getElementById('new-prof-test').value;
      if (!name || !password) return;

      const newProf = {
        id: `prof_${Date.now()}`,
        name,
        password,
        language,
        target_test,
        accent_pref: language === 'en' ? 'en-GB' : language,
        voice_uri: '',
        ttft_threshold_ms: 2500,
        retype_penalty_count: 1,
        session_size: 15,
        activeListIds: []
      };
      newProf.activeListIds = getScopedListsForProfile(newProf).map(l => l.meta.id);
      state.profiles.push(newProf);
      loginToProfile(newProf.id);
    });
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function init() {
    try {
      const rawLocal = localStorage.getItem(STORAGE_KEY);
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal);
        if (parsed && Array.isArray(parsed.profiles)) {
          pruneUnseenProgress(parsed.wordProgress);
          state = Object.assign(createDefaultState(), parsed);
        }
      }
    } catch (_) {}

    applyTheme();
    bindEvents();
    renderLoginScreen();

    await loadPersistedState();
    applyTheme();
    if (!state.activeProfileId) {
      renderLoginScreen();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
