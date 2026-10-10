import AppKit
import QuotioApplication
import QuotioDomain
import SwiftUI

struct QuotaDisplaySettingsSection: View {
    @Environment(MenuBarSettingsManager.self) private var settings
    @Environment(QuotaHistoryServiceModel.self) private var history
    @Environment(QuotaScreenModel.self) private var quota
    @State private var confirmsClearAll = false

    private var displayModeBinding: Binding<QuotaDisplayMode> {
        Binding(
            get: { settings.quotaDisplayMode },
            set: { settings.quotaDisplayMode = $0 }
        )
    }

    private var displayStyleBinding: Binding<QuotaDisplayStyle> {
        Binding(
            get: { settings.quotaDisplayStyle },
            set: { settings.quotaDisplayStyle = $0 }
        )
    }

    @ViewBuilder private var historyStatus: some View {
        if !history.availability.connected {
            Label("history.offline".localized(), systemImage: "wifi.slash")
        } else if !history.availability.canRead {
            Label((history.error == .storage ? "history.storageFailed" : history.error == .unauthorized ? "history.ownerOnly" : "history.unsupported").localized(),
                  systemImage: "exclamationmark.triangle")
        } else if history.error != nil {
            Label("history.settingsFailed".localized(), systemImage: "exclamationmark.triangle")
        } else if let enabled = history.recordingEnabled {
            Label((enabled ? "history.status.recording" : "history.status.paused").localized(),
                  systemImage: enabled ? "record.circle" : "pause.circle")
        }
    }

    var body: some View {
        Section {
            Picker("settings.quota.displayMode".localized(), selection: displayModeBinding) {
                Text("settings.quota.displayMode.used".localized()).tag(QuotaDisplayMode.used)
                Text("settings.quota.displayMode.remaining".localized()).tag(QuotaDisplayMode.remaining)
            }
            .pickerStyle(.segmented)

            Picker("settings.quota.displayStyle".localized(), selection: displayStyleBinding) {
                ForEach(QuotaDisplayStyle.allCases) { style in
                    Text(style.localizationKey.localized()).tag(style)
                }
            }
            .pickerStyle(.segmented)
            VStack(alignment: .leading, spacing: 8) {
                Text("history.title".localized()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Toggle("history.recording".localized(), isOn: Binding(
                        get: { history.recordingEnabled ?? false },
                        set: { enabled in Task { await history.setRecording(enabled) } }
                    ))
                    .disabled(!history.availability.connected || !history.availability.canWrite || history.recordingEnabled == nil || history.isWorking)
                    Text("history.settingsHelp".localized()).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    historyStatus.font(.caption).foregroundStyle(.secondary)
                    if history.error != nil && history.availability.canRead {
                        Button("action.retry".localized()) { Task { await history.loadSettings() } }.controlSize(.small)
                    }
                    Spacer(minLength: 8)
                    if history.isWorking { ProgressView().controlSize(.small) }
                    Button("history.clearAll".localized(), role: .destructive) { confirmsClearAll = true }
                        .disabled(!history.availability.connected || !history.availability.canWrite || history.isWorking)
                }
            }
        } header: {
            Label("settings.quota.display".localized(), systemImage: "percent")
        } footer: {
            Text("settings.quota.display.help".localized())
                .font(.caption)
        }
        .task(id: quota.state.historyAvailability) { await history.loadSettings() }
        .confirmationDialog("history.clearAll".localized(), isPresented: $confirmsClearAll, titleVisibility: .visible) {
            Button("history.clearAll".localized(), role: .destructive) { Task { await history.clearAll() } }
            Button("action.cancel".localized(), role: .cancel) {}
        } message: { Text("history.clearHelp".localized()) }
    }
}
