# Moodelier

Visualize your year in color. Each day becomes a little colored cell on a calendar grid, so you can see how you've been feeling at a glance. Log your mood daily with colors, emojis, and notes. By the end of the year you'll have a full picture of your emotional patterns.

![Mood Tracker](https://img.shields.io/badge/mood-tracker-1dd1a1) ![Firebase](https://img.shields.io/badge/firebase-backend-ff9f43) ![Vanilla JS](https://img.shields.io/badge/vanilla-js-feca57)

## Features

- **Colorful year view** - Every day is a colored cell, which fills up the calendar as you log moods throughout the year
- **Daily mood logging** - Pick a mood level (color-coded from red to green), choose an emoji, add an optional note
- **Multiple views** - Switch between grid, month, and timeline layouts
- **Analytics** - See your mood trends, weekly patterns, and distribution
- **Cloud sync** - Data saved to Firebase so you can access it anywhere
- **Year picker** - Browse through different years

## Tech Stack

- Vanilla HTML/CSS/JS (no frameworks)
- Firebase Authentication
- Cloud Firestore

## Setup

1. Clone the repo
2. Replace the Firebase config in `js/index.js` and `js/auth.js` with your own
3. Enable Email/Password auth in Firebase Console
4. Open `index.html` in a browser or serve it locally

## Screenshots

The app uses a dark theme. Each day appears as a small colored cell: bad days are red/orange, good days are blue/green. Over time your calendar fills up with colors showing your emotional journey through the year.

## License

Do whatever you want with it.
