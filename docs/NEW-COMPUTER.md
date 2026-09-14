# Moving to a new computer

The app itself does not live on any one computer. This page is about the
computer used to **change and publish** it.

## What keeps running without this computer

All of these run in the cloud and do not care whether this computer is on, off,
lost or replaced:

- The website and the installed app, on Firebase Hosting.
- Everybody's accounts, lessons, results, notes, workbooks and settings, in
  Firestore.
- Signing in, through Firebase Authentication.
- Push notifications and booking emails, sent by the scheduled GitHub workflow.
- Keeping the installed app's icon in step with the logo, from the same workflow.

Nobody using the app is affected by a change of computer.

## What exists only on this computer

Two files are deliberately kept out of GitHub, because the repository is public
and they hold private keys:

| File | What it holds | If it is lost |
|---|---|---|
| `serviceAccount.json` | The key that lets scripts and the workflow act on the Firebase project | Download a new one at any time. See below. |
| `.env` | App settings, plus three private keys | Most values can be looked up again. **Two cannot:** `VAPID_PRIVATE_KEY` and `PASSWORD_PRIVATE_KEY`. |

**Keep a private copy of both files** somewhere only you can reach: a password
manager, or a private folder in your own Google Drive or OneDrive. Never put them
in GitHub, and never send them by email or WhatsApp.

## Setting up the new computer

1. Install **Node.js 22 LTS**, **Git** and the **GitHub CLI**.
2. Get the code:

   ```bash
   git clone https://github.com/akmrifan1978/weeklyclass.lms.git
   ```

3. In the new `weeklyclass.lms` folder, install what it needs:

   ```bash
   npm install
   ```

4. Put your private copies of `.env` and `serviceAccount.json` into that folder.
   Without copies, recreate them as described in the next section.
5. Sign in to Firebase and to GitHub:

   ```bash
   npx firebase login
   ```

   ```bash
   gh auth login
   ```

6. Publish, to prove everything works:

   ```bash
   npm run deploy:web
   ```

## If the private copies were lost

- **`serviceAccount.json`.** Firebase Console, Project settings, Service accounts,
  Generate new private key. Save it as `serviceAccount.json` in the project folder,
  then put the whole file into the GitHub secret `FIREBASE_SERVICE_ACCOUNT`.
- **`.env`.** Copy `.env.example` to `.env`. Every name in it says where its value
  comes from. The Firebase values are in Firebase Console, Project settings, Your
  apps; the Cloudinary values are in the Cloudinary dashboard.
- **The push key pair**, `EXPO_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
  Make a new pair with `npx web-push generate-vapid-keys`, put both in `.env`,
  update the GitHub secrets `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and publish.
  Phones and computers that already allowed notifications re-subscribe with the
  new key by themselves the next time the app opens.
- **The password key pair**, `EXPO_PUBLIC_PASSWORD_PUBLIC_KEY` and
  `PASSWORD_PRIVATE_KEY`. Run `node scripts/make-password-key.js`, put both in
  `.env`, update the GitHub secret `PASSWORD_PRIVATE_KEY`, and publish. The only
  cost is a password change an admin had started and not yet applied.

## People using the app on a new phone or computer

They sign in with their mobile number, username or email and find everything as
they left it. Two things belong to a device rather than an account, so they are
set up again on each new one:

- Allowing notifications, which each browser or phone asks for itself.
- Adding the app to the home screen, which is done per device.
