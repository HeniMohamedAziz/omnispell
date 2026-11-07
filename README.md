# OMNISPELL

**OMNISPELL** is a fast, distraction-free offline desktop spelling and vocabulary trainer built for **IELTS English** preparation and **CEFR (A1-C2)** vocabulary mastery.

> **Note:** This version of OMNISPELL is focused on **IELTS English**. All built-in word lists, definitions, context sentences, and audio accents (British, American, and Australian English) are built for English learners preparing for the **IELTS Listening, Reading, and Writing** exams, as well as general **CEFR A1 through C2** English proficiency. You can also import or create custom word lists inside the app.

---

## Overview

Spelling mistakes are one of the most common reasons candidates lose marks in **IELTS Listening** (where a single wrong letter marks the answer incorrect) and **IELTS Writing Task 1 & Task 2** (under *Lexical Resource*).

OMNISPELL trains active recall and exact spelling through three focused practice modes and a **3x Consecutive Mastery** system so you don't repeat the same mistakes.

---

## Built-In Word Lists (1,746 English Words)

Every word includes a definition, part of speech, an exam-style context sentence with a blank, and a spelling hint.

| Word List | Level / Focus | Words | Description |
| :--- | :--- | :---: | :--- |
| **IELTS Top 300 Most Common Words** | IELTS Core | **300** | The 300 most frequently tested words across IELTS Listening, Reading, and Writing. |
| **CEFR A1 - Beginner Vocabulary** | A1 | **173** | Everyday foundational English words. |
| **CEFR A2 - Elementary Vocabulary** | A2 | **176** | Core elementary words for daily life, travel, work, and study. |
| **CEFR B1 - Intermediate Vocabulary** | B1 | **195** | Intermediate words for education, environment, and connected writing. |
| **CEFR B2 - Upper-Intermediate Vocabulary** | B2 | **314** | Academic and analytical vocabulary for Band 6.5-7.0 essays and arguments. |
| **CEFR C1 - Advanced Academic Vocabulary** | C1 | **203** | High-level academic and professional vocabulary for Band 7.5-8.0 writing. |
| **CEFR C2 - Mastery & Proficiency Vocabulary** | C2 | **385** | Advanced proficiency vocabulary for Band 8.5-9.0 mastery. |

---

## Features

- **3 Practice Modes:**
  1. **Follow The Sound:** Hear the word spoken out loud and spell it from sound alone (great for IELTS Listening).
  2. **Guess The Word:** Read the definition and letter pattern (first letter and word length) and type the word without audio.
  3. **Complete Sentence:** Read a sentence with a missing blank alongside its meaning, and spell the missing word.
- **3x Consecutive Mistake Mastery:**
  - When you misspell a word during practice, you type the correction once to continue, and the word is added to **Words To Master**.
  - To clear a word from **Words To Master**, you must spell it **3 times in a row** in sound mode. If you get 2 right and miss the 3rd, your streak resets to `0 / 3`.
  - If you misspell an already-mastered word later on, it moves back to **Words To Master**.
- **Locked Practice Sessions & Countdown:**
  - Starting a mode triggers a full-screen countdown (`1 -> 2 -> 3`) before the first word appears.
  - Once a session starts, the mode is locked until you finish or exit.
- **Offline Audio & Local Storage:**
  - Uses local speech synthesis (`en-GB`, `en-US`, and `en-AU`) with adjustable normal and slow playback speeds.
  - All profiles, progress, custom lists, and settings are saved locally on your PC.
- **Custom Word Lists & CSV/JSON Import:**
  - Create custom word lists in the app or import `.csv` / `.json` files using the downloadable template.
- **Light & Dark Mode:**
  - Clean black, white, and blue grid interface with instant Light/Dark mode toggle.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)

### 1. Clone the Repository
```bash
git clone https://github.com/HeniMohamedAziz/omnispell.git
cd omnispell
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run the App

**Desktop App (Electron):**
```bash
npm start
```
*(On Windows, you can also double-click `launch-omnispell.bat`.)*

**Local Web Server (Browser):**
```bash
npm run serve
```
Then open `http://localhost:4173` in your browser.

---

## How to Use

1. **Create a Profile:**
   - On the **Select Profile** screen, click **`+ New Profile`**.
   - Enter a username and password, choose **English**, and select **IELTS** under **Target Test**.
2. **Select a Word List:**
   - Use the dropdown menu above the mode cards on the **Home** or **Practice** tab to pick a specific word list (such as **IELTS Top 300 Most Common Words** or any **CEFR A1-C2** list) or **All Word Lists (1746 words)**.
3. **Choose a Practice Mode:**
   - **Follow The Sound:** Listen to the word and type the exact spelling. Use **Hear Word** or **Slow** to replay the audio, or click **Hint** to see the definition.
   - **Guess The Word:** Use the definition and letter boxes (`A _ _ _ _`) to spell the word.
   - **Complete Sentence:** Read the context sentence and meaning to fill in the missing word.
4. **Master Your Mistakes (3x Consecutive):**
   - Words you miss appear in the **Words To Master** table on the **Home** tab.
   - Click **Master (3x)** next to any word and spell it right **3 times in a row** to mark it as mastered.
5. **Settings & Backup:**
   - Open **Settings** to change **Words Per Session** (`5`, `10`, `15`, `25`, `50`, `100`, or **Full List**), **Start Countdown**, **Word Order**, **Voice Accent & Speed**, or to export/import your backup `.json` file.

---

## Theme & Design Credit

The interface and theme are inspired by **[BelekGhalet](https://belekghalet.mohamedazizheni.tn)** (`belekghalet.mohamedazizheni.tn`).

---

## License

MIT License

