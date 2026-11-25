// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LevelmaxingWatch",
    platforms: [.macOS(.v14), .watchOS(.v10)],
    products: [
        .library(name: "LevelmaxingWatchCore", targets: ["LevelmaxingWatchCore"]),
    ],
    targets: [
        .target(name: "LevelmaxingWatchCore"),
        .testTarget(
            name: "LevelmaxingWatchCoreTests",
            dependencies: ["LevelmaxingWatchCore"]
        ),
    ]
)
