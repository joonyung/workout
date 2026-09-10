import SwiftUI
import WorkoutWatchCore

struct RootView: View {
    @EnvironmentObject private var model: WatchWorkoutModel

    var body: some View {
        Group {
            if model.needsSetup {
                ContentUnavailableView(
                    "설정이 필요합니다",
                    systemImage: "iphone.and.arrow.forward",
                    description: Text("iPhone의 Workout 앱에서 서버 설정을 저장하세요.")
                )
            } else if model.isLoading && model.session == nil {
                ProgressView("프로그램 불러오는 중")
            } else if let message = model.errorMessage, model.session == nil {
                ContentUnavailableView {
                    Label("연결 실패", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("다시 시도") { model.refresh() }
                }
            } else if model.session != nil {
                WorkoutHomeView()
            } else {
                ContentUnavailableView(
                    "오늘 프로그램 없음",
                    systemImage: "calendar.badge.exclamationmark"
                )
            }
        }
    }
}

struct WorkoutHomeView: View {
    @EnvironmentObject private var model: WatchWorkoutModel
    @State private var showingFinish = false

    var body: some View {
        NavigationStack {
            List {
                if let session = model.session {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(session.title ?? "오늘 운동")
                                .font(.headline)
                            Text("\(model.completedSets) / \(model.targetSets)세트")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            ProgressView(
                                value: Double(model.completedSets),
                                total: Double(max(1, model.targetSets))
                            )
                        }
                    }

                    if let restEndsAt = model.restEndsAt {
                        Section {
                            RestTimerView(endsAt: restEndsAt) {
                                model.cancelRestTimer()
                            }
                        }
                    }

                    Section("근력") {
                        ForEach(session.exercises) { exercise in
                            NavigationLink {
                                ExerciseDetailView(exerciseID: exercise.id)
                            } label: {
                                ExerciseRow(exercise: exercise)
                            }
                        }
                    }

                    if let cardio = session.cardio, !cardio.isEmpty {
                        Section("유산소") {
                            ForEach(cardio) { item in
                                NavigationLink {
                                    CardioEntryView(cardioID: item.id)
                                } label: {
                                    HStack {
                                        VStack(alignment: .leading) {
                                            Text(item.name)
                                            Text("목표 \(item.targetMinutes.formatted())분")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        if item.completed { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green) }
                                    }
                                }
                            }
                        }
                    }

                    Section {
                        Button(session.isFinished ? "운동 완료" : "운동 마치기") {
                            showingFinish = true
                        }
                        .disabled(session.isFinished)
                    }
                }
            }
            .navigationTitle("Workout")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { model.refresh() } label: {
                        Image(systemName: syncSymbol)
                    }
                }
            }
            .sheet(isPresented: $showingFinish) {
                FinishWorkoutView()
            }
        }
    }

    private var syncSymbol: String {
        switch model.syncState {
        case .syncing: "arrow.triangle.2.circlepath"
        case .pending: "icloud.slash"
        case .synced: "checkmark.icloud"
        case .idle: "arrow.clockwise"
        }
    }
}

private struct ExerciseRow: View {
    let exercise: SessionExercise

    var body: some View {
        let completed = exercise.sets.filter(\.isCompleted).count
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(exercise.name)
                    .lineLimit(2)
                Text("\(completed)/\(exercise.targetSets) · \(targetLabel)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if completed == exercise.targetSets {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            }
        }
    }

    private var targetLabel: String {
        let unit = exercise.weightUnit.rawValue
        let weight = exercise.weightUnit == .lb
            ? exercise.startingWeightLb?.value
            : exercise.startingWeightKg?.value
        let range = exercise.repRange.count >= 2
            ? "\(exercise.repRange[0])-\(exercise.repRange[1])회"
            : "반복 기록"
        guard let weight else { return range }
        return "\(weight.formatted())\(unit) · \(range)"
    }
}

private struct RestTimerView: View {
    let endsAt: Date
    let cancel: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = max(0, Int(ceil(endsAt.timeIntervalSince(context.date))))
            HStack {
                Label(timeLabel(remaining), systemImage: "timer")
                    .font(.headline.monospacedDigit())
                Spacer()
                Button(action: cancel) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func timeLabel(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
