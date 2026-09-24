# macOS installer

Builds `6amAgent-<version>-<arm64|x64>.pkg` from a per-target payload produced by `npm run build -- --target darwin-arm64` (layout in `docs/architecture/agent.md` §1). The Mac needs no Node, npm or SQLite: the pkg ships the Node runtime.

```sh
packaging/macos/build-pkg.sh dist/darwin-arm64 1.0.0
packaging/macos/build-pkg.sh dist/darwin-arm64 1.0.0 \
  --sign "Developer ID Installer: 6AM Technologies (TEAMID)" --notarize-profile 6am-notary
```

Signing and notarization run only when their options are given. Notarization needs Xcode (`xcrun notarytool`) and a profile stored with `xcrun notarytool store-credentials`.

## What the pkg does

- Installs the payload to `/Library/Application Support/6amAgent/<version>` and points the `current` symlink at it.
- `postinstall` (root) finds the console user and runs `agent.cjs install-service` as that user, which writes `~/Library/LaunchAgents/com.6amtech.agent.plist` and bootstraps it into `gui/<uid>`. On a first install (no `device_token` in the Keychain) it also runs `agent.cjs pair`, which opens pairing in the user's browser. It removes versions that no user's LaunchAgent still points at.
- With no user at the console (for example, an MDM push), it installs files only. Each user then runs `".../current/runtime/node" ".../current/app/agent.cjs" install-service`.

## Uninstall

```sh
sudo "/Library/Application Support/6amAgent/current/uninstall.sh"
```

For every user with the agent, the script runs `uninstall-service` (stops the LaunchAgent and deregisters the device, best effort), deletes the `com.6amtech.agent` Keychain items and `~/Library/Application Support/6amAgent`, then removes the install dir and the pkg receipt. It keeps only `~/Library/Logs/6amAgent`. Server-side history is never deleted.

## Runtime locations

| What        | Where                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| LaunchAgent | `~/Library/LaunchAgents/com.6amtech.agent.plist` (`RunAtLoad`, `KeepAlive.SuccessfulExit=false`, `ThrottleInterval` 30)                           |
| App data    | `~/Library/Application Support/6amAgent`                                                                                                          |
| Logs        | `~/Library/Logs/6amAgent` (`launchd.out.log`, `launchd.err.log`)                                                                                  |
| Credentials | login Keychain, generic password, service `com.6amtech.agent`; a `0600` `credentials.json` in app data only when no Keychain is usable (headless) |
