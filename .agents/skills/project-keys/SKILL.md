---
name: project-keys
description: Give a project the keys it needs (Amplitude, App Store Connect, Cloudflare, any API) from Kyle's one key store. Use when starting a new app or site, adding a service that needs a key, setting up Xcode Cloud for an app, or when analytics isn't arriving from a build.
---

# Project keys

Every key lives in one place: `~/Developer/.secrets/keys.env` on Kyle's Mac, outside every repo, backed up in his password manager. Projects never hold the only copy of a key, and nobody types a key into a project by hand. `~/Developer/ops/scripts/sync-keys.mjs` copies keys from the store into each repo's gitignored files.

## Which keys go where

- **Amplitude, one project per product.** The API key decides which project events land in, so each product has its own key, and every copy, worktree, Dev app and website of that product uses the same one. Experiments on kylepace.dev share the kylepace.dev key.
- **Websites** keep their Amplitude key in their own config file, in Git (it's public by design, and Cloudflare builds from GitHub need it): one constant in one file, no build-variable overrides.
- **Apps** keep their Amplitude key out of Git: `Secrets.xcconfig` (gitignored) sets `AMPLITUDE_API_KEY`, an `Analytics.xcconfig` that's in Git includes it, and Info.plist passes it to `Analytics.swift` as `AmplitudeAPIKey`. With no key, analytics stays off.
- **Real secrets** (Amplitude secret keys, API tokens, private keys) live only in the store, `.dev.vars`-style gitignored files, GitHub Actions secrets, Worker secrets and Xcode Cloud workflow secrets. Never in Git, a chat or a log.

## A new project

1. **Make the account or project** in the service (for Amplitude: https://app.amplitude.com/analytics/kylepace-262949/settings/projects, then add the project's row to the "All projects overview" dashboard). Kyle may need to do this step; give him that link.
2. **Add the keys to the store** with plain names: `AMPLITUDE_<PRODUCT>_API_KEY`, `AMPLITUDE_<PRODUCT>_SECRET_KEY`, `<SERVICE>_TOKEN`. Kyle pastes them in; never ask for a key in chat. If the product's Amplitude secret key is there, add its project ID to `AMPLITUDE_PROJECTS` in the sync script so Ops can read it.
3. **Add `.agents/keys.json` to the repo** saying which gitignored file each key goes in (the format is at the top of `sync-keys.mjs`). For an app:

   ```json
   {
     "files": [
       {
         "path": "App/Secrets.xcconfig",
         "format": "xcconfig",
         "set": { "AMPLITUDE_API_KEY": "AMPLITUDE_<PRODUCT>_API_KEY" },
         "xcode_cloud": true
       }
     ]
   }
   ```

   Check that `.gitignore` covers the file; the script won't write a file Git would commit.
4. **Run the sync:** `node ~/Developer/ops/scripts/sync-keys.mjs` (`--check` first to see what it will do).
5. **For an app on Xcode Cloud:** `ci_scripts/ci_post_clone.sh` writes `Secrets.xcconfig` from the workflow's `AMPLITUDE_API_KEY` secret and **stops the build when it's missing**, so a TestFlight build never ships with analytics quietly off. Add the secret to every workflow (Xcode: Product > Xcode Cloud > Manage Workflows > the workflow > Environment). `node ~/Developer/ops/scripts/sync-keys.mjs --xcode-cloud` lists what each app needs.
6. **Check it arrives:** after the first real build or deploy, look in Amplitude for events from that platform.

## A new copy or worktree

Nothing to do but run the sync. Copies and worktrees on an older commit use the main checkout's `keys.json` (`COPIES` in the script); add a line there for a new family of folders.

## When analytics isn't arriving

In order: is the key in the store, did the sync write it (`--check` says "already up to date"), is it the right product's key (compare the first four characters with the project's settings page), and for a TestFlight build, does the Xcode Cloud workflow have the secret.
