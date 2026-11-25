import Foundation
import Testing
@testable import LevelmaxingWatchCore

struct CompanionTests {
    private let now = Date(timeIntervalSince1970: 10_000)
    private let requestID = UUID()
    private let accountA = UUID()
    private let accountB = UUID()

    private func snapshot(
        generation: UInt64 = 1,
        bindingID: UUID?,
        revision: UInt64 = 1,
        workout: WorkoutSnapshot? = nil,
        secondsValid: TimeInterval = 45,
        challenge: UUID? = nil
    ) -> CompanionSnapshot {
        CompanionSnapshot(
            requestID: challenge ?? requestID,
            bindingGeneration: generation,
            bindingID: bindingID,
            revision: revision,
            expiresAt: now.addingTimeInterval(secondsValid),
            workout: workout
        )
    }

    @Test func accountSwitchAndSignOutRejectLateSnapshots() {
        var gate = SnapshotGate()
        let workout = WorkoutSnapshot(exerciseName: "Incline press", completedSets: 2, restEndsAt: nil)
        let acceptedInitial = gate.accept(snapshot(bindingID: accountA, workout: workout), requestID: requestID, now: now)
        #expect(acceptedInitial)
        #expect(gate.content(at: now) == .workout(workout))
        let acceptedSwitch = gate.accept(snapshot(generation: 2, bindingID: accountB, revision: 0), requestID: requestID, now: now)
        #expect(acceptedSwitch)
        let acceptedLatePriorAccount = gate.accept(snapshot(bindingID: accountA, revision: 999, workout: workout), requestID: requestID, now: now)
        #expect(!acceptedLatePriorAccount)
        #expect(gate.content(at: now) == .ready)
        let acceptedSignOut = gate.accept(snapshot(generation: 3, bindingID: nil), requestID: requestID, now: now)
        #expect(acceptedSignOut)
        let acceptedRebindWithoutNewGeneration = gate.accept(snapshot(generation: 3, bindingID: accountA, workout: workout), requestID: requestID, now: now)
        #expect(!acceptedRebindWithoutNewGeneration)
        #expect(gate.content(at: now) == .signInRequired)
    }

    @Test func exactRevisionCanRenewButCannotChangeContent() {
        var gate = SnapshotGate()
        let original = WorkoutSnapshot(exerciseName: "Incline press", completedSets: 2, restEndsAt: nil)
        let replacement = WorkoutSnapshot(exerciseName: "Incline press", completedSets: 3, restEndsAt: nil)
        let acceptedOriginal = gate.accept(snapshot(bindingID: accountA, revision: 5, workout: original), requestID: requestID, now: now)
        #expect(acceptedOriginal)
        let acceptedRenewal = gate.accept(snapshot(bindingID: accountA, revision: 5, workout: original, secondsValid: 60), requestID: requestID, now: now)
        #expect(acceptedRenewal)
        let acceptedReplacementWithoutNewRevision = gate.accept(snapshot(bindingID: accountA, revision: 5, workout: replacement), requestID: requestID, now: now)
        #expect(!acceptedReplacementWithoutNewRevision)
        #expect(gate.content(at: now.addingTimeInterval(59)) == .workout(original))
        #expect(gate.content(at: now.addingTimeInterval(60)) == nil)
        let acceptedNewRevision = gate.accept(snapshot(bindingID: accountA, revision: 6, workout: replacement), requestID: requestID, now: now)
        #expect(acceptedNewRevision)
        gate.hide()
        let acceptedHiddenPriorRevision = gate.accept(snapshot(bindingID: accountA, revision: 5, workout: original), requestID: requestID, now: now)
        #expect(!acceptedHiddenPriorRevision)
        #expect(gate.content(at: now) == nil)
    }

    @Test func malformedExpiredAndUnsolicitedSnapshotsDoNotRevealWorkout() {
        var gate = SnapshotGate()
        let workout = WorkoutSnapshot(exerciseName: "Incline press", completedSets: 2, restEndsAt: nil)
        let invalid = WorkoutSnapshot(exerciseName: "  ", completedSets: -1, restEndsAt: nil)
        let acceptedWrongChallenge = gate.accept(snapshot(bindingID: accountA, workout: workout, challenge: UUID()), requestID: requestID, now: now)
        #expect(!acceptedWrongChallenge)
        let acceptedExpired = gate.accept(snapshot(bindingID: accountA, workout: workout, secondsValid: 0), requestID: requestID, now: now)
        #expect(!acceptedExpired)
        let acceptedOverlongLease = gate.accept(snapshot(bindingID: accountA, workout: workout, secondsValid: 61), requestID: requestID, now: now)
        #expect(!acceptedOverlongLease)
        let acceptedUnboundWorkout = gate.accept(snapshot(bindingID: nil, workout: workout), requestID: requestID, now: now)
        #expect(!acceptedUnboundWorkout)
        let acceptedInvalidWorkout = gate.accept(snapshot(bindingID: accountA, workout: invalid), requestID: requestID, now: now)
        #expect(!acceptedInvalidWorkout)
        #expect(gate.content(at: now) == nil)
    }

    @Test func wireRequestIncludesVersionAndChallenge() throws {
        let request = SnapshotRequest(requestID: requestID)
        let encoded = try JSONEncoder().encode(request)
        let decoded = try JSONDecoder().decode(SnapshotRequest.self, from: encoded)
        #expect(decoded == request)
    }
}
