// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WorkoutWatchCore",
    platforms: [
        .iOS(.v17),
        .watchOS(.v10),
        .macOS(.v13)
    ],
    products: [
        .library(name: "WorkoutWatchCore", targets: ["WorkoutWatchCore"])
    ],
    targets: [
        .target(name: "WorkoutWatchCore"),
        .testTarget(name: "WorkoutWatchCoreTests", dependencies: ["WorkoutWatchCore"])
    ]
)
