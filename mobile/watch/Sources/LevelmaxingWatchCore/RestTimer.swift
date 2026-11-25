import Foundation

public enum RestTimerState: Equatable, Sendable {
    case idle
    case running(secondsRemaining: Int)
    case finished
}

public struct RestTimer: Equatable, Sendable {
    public static let initialDuration: TimeInterval = 90
    public static let extensionDuration: TimeInterval = 15
    public static let maximumDuration: TimeInterval = 600

    public private(set) var deadline: Date?

    public init() {}

    public mutating func start(at now: Date) {
        deadline = now.addingTimeInterval(Self.initialDuration)
    }

    public mutating func extend(at now: Date) {
        guard let deadline, deadline > now else { return }
        self.deadline = min(
            deadline.addingTimeInterval(Self.extensionDuration),
            now.addingTimeInterval(Self.maximumDuration)
        )
    }

    public mutating func reset() {
        deadline = nil
    }

    public func state(at now: Date) -> RestTimerState {
        guard let deadline else { return .idle }
        let remaining = Self.secondsRemaining(until: deadline, now: now)
        return remaining > 0 ? .running(secondsRemaining: remaining) : .finished
    }

    public static func secondsRemaining(until deadline: Date, now: Date) -> Int {
        let interval = deadline.timeIntervalSince(now)
        guard interval.isFinite, interval > 0 else { return 0 }
        return Int(min(Self.maximumDuration, interval).rounded(.up))
    }
}
