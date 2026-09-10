import SwiftUI
import WorkoutWatchCore

struct CardioEntryView: View {
    @EnvironmentObject private var model: WatchWorkoutModel
    @Environment(\.dismiss) private var dismiss
    let cardioID: String

    @State private var minutes = 15.0
    @State private var distance = 0.0
    @State private var heartRate = 0
    @State private var rpe = 4.0
    @State private var completed = false
    @State private var loaded = false

    var body: some View {
        Form {
            if let cardio = cardio {
                Section("목표") {
                    Text("\(cardio.targetMinutes.formatted())분 · RPE \(rangeText(cardio.rpeRange))")
                }
                Section {
                    Stepper(value: $minutes, in: 1...180, step: 1) {
                        metric("시간", "\(minutes.formatted())분")
                    }
                    Stepper(value: $distance, in: 0...100, step: 0.1) {
                        metric("거리", "\(distance.formatted())km")
                    }
                    Stepper(value: $heartRate, in: 0...240, step: 1) {
                        metric("평균 심박", heartRate > 0 ? "\(heartRate)bpm" : "선택")
                    }
                    Stepper(value: $rpe, in: 1...10, step: 0.5) {
                        metric("RPE", rpe.formatted())
                    }
                }
                Section {
                    Toggle("유산소 완료", isOn: $completed)
                    Button("저장") {
                        model.saveCardio(
                            id: cardioID,
                            minutes: minutes,
                            distanceKm: distance > 0 ? distance : nil,
                            averageHeartRate: heartRate > 0 ? Double(heartRate) : nil,
                            rpe: rpe,
                            completed: completed
                        )
                        dismiss()
                    }
                }
            }
        }
        .navigationTitle(cardio?.name ?? "유산소")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: loadValues)
    }

    private var cardio: SessionCardio? {
        model.session?.cardio?.first(where: { $0.id == cardioID })
    }

    private func loadValues() {
        guard !loaded, let cardio else { return }
        minutes = cardio.durationMinutes?.value ?? cardio.targetMinutes
        distance = cardio.distanceKm?.value ?? 0
        heartRate = Int(cardio.averageHeartRate?.value ?? 0)
        rpe = cardio.rpe?.value ?? cardio.rpeRange.first ?? 4
        completed = cardio.completed
        loaded = true
    }

    private func metric(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).font(.headline.monospacedDigit()).foregroundStyle(.tint)
        }
    }

    private func rangeText(_ range: [Double]) -> String {
        guard let first = range.first, let last = range.last else { return "기록" }
        return "\(first.formatted())-\(last.formatted())"
    }
}
