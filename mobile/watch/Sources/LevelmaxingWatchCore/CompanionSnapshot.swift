import Foundation

public struct SnapshotRequest: Codable, Equatable, Sendable {
    public let protocolVersion = 1
    public let requestID: UUID

    public init(requestID: UUID) {
        self.requestID = requestID
    }

    private enum CodingKeys: String, CodingKey {
        case protocolVersion, requestID
    }

    public init(from decoder: any Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        guard try fields.decode(Int.self, forKey: .protocolVersion) == 1 else {
            throw DecodingError.dataCorruptedError(
                forKey: .protocolVersion,
                in: fields,
                debugDescription: "Unsupported snapshot request version."
            )
        }
        requestID = try fields.decode(UUID.self, forKey: .requestID)
    }
}

public struct WorkoutSnapshot: Codable, Equatable, Sendable {
    public let exerciseName: String
    public let completedSets: Int
    public let restEndsAt: Date?

    public init(exerciseName: String, completedSets: Int, restEndsAt: Date?) {
        self.exerciseName = exerciseName
        self.completedSets = completedSets
        self.restEndsAt = restEndsAt
    }
}

public struct CompanionSnapshot: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let requestID: UUID
    public let bindingGeneration: UInt64
    public let bindingID: UUID?
    public let revision: UInt64
    public let expiresAt: Date
    public let workout: WorkoutSnapshot?

    public init(
        protocolVersion: Int = 1,
        requestID: UUID,
        bindingGeneration: UInt64,
        bindingID: UUID?,
        revision: UInt64,
        expiresAt: Date,
        workout: WorkoutSnapshot?
    ) {
        self.protocolVersion = protocolVersion
        self.requestID = requestID
        self.bindingGeneration = bindingGeneration
        self.bindingID = bindingID
        self.revision = revision
        self.expiresAt = expiresAt
        self.workout = workout
    }
}

public enum CompanionContent: Equatable, Sendable {
    case signInRequired
    case ready
    case workout(WorkoutSnapshot)
}

public struct SnapshotGate: Sendable {
    public static let maximumLease: TimeInterval = 60

    private var lastRevision: Revision?
    private var visibleSnapshot: CompanionSnapshot?

    public init() {}

    public mutating func accept(
        _ snapshot: CompanionSnapshot,
        requestID: UUID,
        now: Date
    ) -> Bool {
        guard snapshot.protocolVersion == 1,
              snapshot.requestID == requestID,
              snapshot.bindingGeneration > 0,
              snapshot.expiresAt > now,
              snapshot.expiresAt.timeIntervalSince(now) <= Self.maximumLease,
              validWorkout(snapshot.workout, bindingID: snapshot.bindingID, now: now)
        else { return false }

        if let lastRevision {
            guard snapshot.bindingGeneration >= lastRevision.generation else { return false }
            if snapshot.bindingGeneration == lastRevision.generation {
                guard snapshot.bindingID == lastRevision.bindingID,
                      snapshot.revision >= lastRevision.number
                else { return false }

                if snapshot.revision == lastRevision.number {
                    guard snapshot.workout == lastRevision.workout else { return false }
                }
            }
        }

        lastRevision = Revision(
            generation: snapshot.bindingGeneration,
            bindingID: snapshot.bindingID,
            number: snapshot.revision,
            workout: snapshot.workout
        )
        visibleSnapshot = snapshot
        return true
    }

    public mutating func hide() {
        visibleSnapshot = nil
    }

    public func content(at now: Date) -> CompanionContent? {
        guard let visibleSnapshot, now < visibleSnapshot.expiresAt else { return nil }
        guard visibleSnapshot.bindingID != nil else { return .signInRequired }
        if let workout = visibleSnapshot.workout {
            return .workout(workout)
        }
        return .ready
    }

    private func validWorkout(_ workout: WorkoutSnapshot?, bindingID: UUID?, now: Date) -> Bool {
        guard let workout else { return true }
        return bindingID != nil
            && !workout.exerciseName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && workout.exerciseName.utf8.count <= 256
            && (0...500).contains(workout.completedSets)
            && (workout.restEndsAt.map { $0.timeIntervalSince(now) <= RestTimer.maximumDuration } ?? true)
    }

    private struct Revision: Sendable {
        let generation: UInt64
        let bindingID: UUID?
        let number: UInt64
        let workout: WorkoutSnapshot?
    }
}
