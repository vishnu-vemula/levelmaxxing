# Levelmaxing for Apple Watch

A native watchOS 10+ companion foundation. Open the shared **LevelmaxingWatch** scheme in `LevelmaxingWatch.xcodeproj`. The standalone rest timer starts at 90 seconds, adds time in 15-second steps up to 10 minutes, and computes remaining time from its deadline when rendering resumes. It works without an iPhone connection and keeps its state for the current app process.

The SwiftUI view owns the local timer. `CompanionConnection` handles the watch-side WatchConnectivity session on the main actor. `LevelmaxingWatchCore` owns the wire models and snapshot rules and has no UI or Apple Watch hardware dependency.

## Phone pairing boundary

The watch requests a small, foreground-only workout snapshot using `WCSession.sendMessageData`. The current mobile build has no iPhone responder or embedded watch product. The watch shows the connection or waiting state until a phone build answers. The local timer remains usable.

The future iPhone responder should decode a `SnapshotRequest` v1 and derive the reply from its active, authenticated workout. It echoes the request UUID, returns an opaque installation-scoped binding ID and a monotonically increasing binding generation, and supplies a revision scoped to that generation. Increment the generation when the phone changes accounts or signs out. For signed-out replies, use a nil binding ID and omit the workout. Renew an unchanged revision with a new expiry and identical workout content. Encode dates as Unix epoch milliseconds and lease each response for at most 60 seconds.

The watch requires a matching foreground request, rejects stale generations and regressive revisions, and hides workout content on reachability loss, app inactivity, malformed replies, or lease expiry. Responses are limited to 4 KiB. The watch keeps snapshots in memory and sends no workout mutations.

Production pairing requires embedding the companion in the signed iOS app, connecting the iPhone responder, and exercising sign-out, account switching, reconnection and delayed delivery on a paired phone and watch. App Store signing and shipping identifiers belong to that release step.

## Validation

From this directory with Swift 6 and an installed watchOS simulator SDK:

```bash
swift test --scratch-path .build/swift

xcodebuild -list -project LevelmaxingWatch.xcodeproj

xcodebuild -project LevelmaxingWatch.xcodeproj \
  -scheme LevelmaxingWatch \
  -destination 'generic/platform=watchOS Simulator' \
  -derivedDataPath .build/xcode \
  -clonedSourcePackagesDirPath .build/xcode-packages \
  -disableAutomaticPackageResolution \
  CODE_SIGNING_ALLOWED=NO build
```

The core tests cover time jumps, rest limits and reset, versioned request round trips, stale account snapshots, same-revision refresh, challenge mismatch and expiry. Timer calculations and snapshot gate checks use constant auxiliary space per accepted snapshot. Timer advancement, extension and reset take constant time. Snapshot decoding and text validation are linear in the bounded reply size.
