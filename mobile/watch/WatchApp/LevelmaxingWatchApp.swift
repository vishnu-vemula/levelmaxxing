import LevelmaxingWatchCore
import SwiftUI

@main
@MainActor
struct LevelmaxingWatchApp: App {
    @State private var companion = CompanionConnection()

    var body: some Scene {
        WindowGroup {
            CompanionView(companion: companion)
                .tint(Color(red: 214.0 / 255, green: 245.0 / 255, blue: 94.0 / 255))
        }
    }
}

private struct CompanionView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var rest = RestTimer()
    let companion: CompanionConnection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Label("Levelmaxing", systemImage: "chart.bar.fill")
                    .font(.headline)
                    .foregroundStyle(.tint)
                    .accessibilityAddTraits(.isHeader)

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    companionCard(at: context.date)
                    restCard(at: context.date)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 8)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            companion.setActive(phase == .active)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(20))
                } catch {
                    return
                }
                companion.refresh()
            }
        }
    }

    @ViewBuilder
    private func companionCard(at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            switch companion.gate.content(at: now) {
            case .workout(let workout):
                Text(workout.exerciseName)
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("Completed sets: \(workout.completedSets)")
                if let deadline = workout.restEndsAt {
                    let seconds = RestTimer.secondsRemaining(until: deadline, now: now)
                    if seconds > 0 {
                        countdown(seconds, label: "Phone rest timer")
                    } else {
                        Text("Phone rest complete")
                    }
                }
            case .ready:
                Text("Ready for your workout").font(.headline)
                Text("Start a session on iPhone.")
            case .signInRequired:
                Text("Sign in on iPhone").font(.headline)
                Text("Open Levelmaxing and sign in to connect this watch.")
            case nil:
                switch companion.status {
                case .unavailable:
                    Text("Phone connection unavailable").font(.headline)
                    Text("The rest timer is available here.")
                case .checking:
                    HStack {
                        ProgressView()
                        Text("Checking phone")
                    }
                    .accessibilityElement(children: .combine)
                case .waiting:
                    Text("Waiting for iPhone").font(.headline)
                    Text("Open Levelmaxing on the paired iPhone.")
                case .connected, .unresponsive:
                    Text("Phone did not send an update").font(.headline)
                    Text("Open Levelmaxing on iPhone and try again.")
                }
                if companion.status == .waiting || companion.status == .unresponsive || companion.status == .connected {
                    Button("Check phone", systemImage: "arrow.clockwise") { companion.refresh() }
                        .buttonStyle(.bordered)
                        .font(.footnote)
                }
            }
        }
        .font(.footnote)
    }

    @ViewBuilder
    private func restCard(at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Rest timer")
                .font(.caption.bold())
                .foregroundStyle(.secondary)
                .accessibilityAddTraits(.isHeader)

            switch rest.state(at: now) {
            case .idle:
                Button("Start 90-second rest", systemImage: "timer") { rest.start(at: .now) }
                    .buttonStyle(.borderedProminent)
                    .foregroundStyle(.black)
            case .running(let seconds):
                countdown(seconds, label: "Rest remaining")
                HStack {
                    Button("+15 sec") { rest.extend(at: .now) }
                        .accessibilityLabel("Add 15 seconds")
                    Button("Reset") { rest.reset() }
                }
                .buttonStyle(.bordered)
                .font(.caption2)
            case .finished:
                Text("Rest complete").font(.headline)
                Button("Start again", systemImage: "timer") { rest.start(at: .now) }
                    .buttonStyle(.borderedProminent)
                    .foregroundStyle(.black)
            }
        }
    }

    private func countdown(_ seconds: Int, label: LocalizedStringKey) -> some View {
        Text(Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond)))
            .font(.title2.bold().monospacedDigit())
            .accessibilityLabel(label)
            .accessibilityValue(Text("\(seconds) seconds"))
    }
}
