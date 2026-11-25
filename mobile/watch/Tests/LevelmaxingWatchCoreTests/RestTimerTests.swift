import Foundation
import Testing
@testable import LevelmaxingWatchCore

struct RestTimerTests {
    private let now = Date(timeIntervalSince1970: 20_000)

    @Test func deadlineSurvivesSkippedTicksAndClampsAtZero() {
        var timer = RestTimer()
        #expect(timer.state(at: now) == .idle)
        timer.start(at: now)
        #expect(timer.state(at: now) == .running(secondsRemaining: 90))
        #expect(timer.state(at: now.addingTimeInterval(89.6)) == .running(secondsRemaining: 1))
        #expect(timer.state(at: now.addingTimeInterval(91)) == .finished)
        timer.extend(at: now.addingTimeInterval(91))
        #expect(timer.state(at: now.addingTimeInterval(91)) == .finished)
        timer.reset()
        #expect(timer.state(at: now) == .idle)
    }

    @Test func extensionAddsTimeWithinMaximum() {
        var timer = RestTimer()
        timer.start(at: now)
        timer.extend(at: now.addingTimeInterval(30))
        #expect(timer.state(at: now.addingTimeInterval(30)) == .running(secondsRemaining: 75))
        for _ in 0..<60 {
            timer.extend(at: now)
        }
        #expect(timer.state(at: now) == .running(secondsRemaining: 600))
    }
}
