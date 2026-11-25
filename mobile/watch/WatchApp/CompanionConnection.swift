import Foundation
import LevelmaxingWatchCore
import Observation
import WatchConnectivity

@MainActor
@Observable
final class CompanionConnection: NSObject, WCSessionDelegate {
    enum Status {
        case checking
        case unavailable
        case waiting
        case unresponsive
        case connected
    }

    private(set) var status: Status = .checking
    private(set) var gate = SnapshotGate()

    @ObservationIgnored private var session: WCSession?
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var inFlightID: UUID?
    @ObservationIgnored private var timeout: Task<Void, Never>?

    func setActive(_ active: Bool) {
        isActive = active
        guard active else {
            invalidateRequest()
            gate.hide()
            status = .waiting
            return
        }
        guard WCSession.isSupported() else {
            status = .unavailable
            return
        }

        let session = self.session ?? WCSession.default
        self.session = session
        if session.activationState == .activated {
            refresh()
        } else {
            status = .checking
            session.delegate = self
            session.activate()
        }
    }

    func refresh() {
        guard isActive, status != .unavailable else { return }
        guard let session, session.activationState == .activated else {
            return
        }
        guard session.isReachable else {
            invalidateRequest()
            gate.hide()
            status = .waiting
            return
        }
        guard inFlightID == nil else { return }

        let challenge = UUID()
        let request = SnapshotRequest(requestID: challenge)
        guard let bytes = try? JSONEncoder().encode(request) else {
            gate.hide()
            status = .unresponsive
            return
        }

        inFlightID = challenge
        if gate.content(at: .now) == nil {
            status = .checking
        }
        timeout = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(8))
            } catch {
                return
            }
            self?.finish(requestID: challenge, reply: nil)
        }

        session.sendMessageData(bytes) { [weak self] reply in
            Task { @MainActor in self?.finish(requestID: challenge, reply: reply) }
        } errorHandler: { [weak self] _ in
            Task { @MainActor in self?.finish(requestID: challenge, reply: nil) }
        }
    }

    private func finish(requestID: UUID, reply: Data?) {
        guard isActive, inFlightID == requestID else { return }
        invalidateRequest()
        guard session?.activationState == .activated, session?.isReachable == true else {
            gate.hide()
            status = .waiting
            return
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        guard let reply, reply.count <= 4_096,
              let snapshot = try? decoder.decode(CompanionSnapshot.self, from: reply),
              gate.accept(snapshot, requestID: requestID, now: .now)
        else {
            gate.hide()
            status = .unresponsive
            return
        }
        status = .connected
    }

    private func invalidateRequest() {
        inFlightID = nil
        timeout?.cancel()
        timeout = nil
    }

    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: (any Error)?
    ) {
        let activated = error == nil && activationState == .activated
        Task { @MainActor [weak self] in
            guard let self, isActive else { return }
            if activated {
                refresh()
            } else {
                invalidateRequest()
                gate.hide()
                status = .unresponsive
            }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor [weak self] in
            self?.refresh()
        }
    }
}
