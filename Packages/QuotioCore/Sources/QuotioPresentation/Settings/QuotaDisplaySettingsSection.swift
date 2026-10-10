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

            VStack(alignment: .leading, spacing: 8) {
                Text("settings.quota.displayStyle".localized())
                QuotaDensityPicker(selection: displayStyleBinding)
                Text("settings.quota.pace.help".localized())
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
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

/// Density choices drawn as small previews of what each one shows.
private struct QuotaDensityPicker: View {
    @Binding var selection: QuotaDisplayStyle

    var body: some View {
        HStack(spacing: 10) {
            ForEach(QuotaDisplayStyle.allCases) { style in
                let isSelected = style == selection
                Button { selection = style } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        QuotaDensityPreview(style: style)
                            .frame(maxWidth: .infinity)
                            .frame(height: 64)
                            .padding(.horizontal, 10)
                            .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        VStack(alignment: .leading, spacing: 1) {
                            Text(style.localizationKey.localized())
                                .font(.callout.weight(.medium))
                                .foregroundStyle(.primary)
                            Text(style.helpKey.localized())
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 4)
                    }
                    .padding(5)
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(isSelected ? Color.accentColor : Color.secondary.opacity(0.25),
                                          lineWidth: isSelected ? 2 : 1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
    }
}

private struct QuotaDensityPreview: View {
    let style: QuotaDisplayStyle

    var body: some View {
        switch style {
        case .compact:
            VStack(spacing: 7) {
                row(fill: 0.7, color: .green)
                row(fill: 0.2, color: .orange)
                row(fill: 0.9, color: .green)
            }
        case .comfortable:
            VStack(alignment: .leading, spacing: 8) {
                Capsule().fill(.quaternary).frame(width: 48, height: 5)
                track(fill: 0.74, tick: 0.34, color: .green)
                track(fill: 0.18, tick: 0.68, color: .orange)
            }
        case .detailed:
            VStack(spacing: 6) {
                track(fill: 0.18, tick: 0.68, color: .orange)
                GeometryReader { proxy in
                    let w = proxy.size.width, h = proxy.size.height
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: h * 0.1))
                        path.addLine(to: CGPoint(x: w * 0.2, y: h * 0.2))
                        path.addLine(to: CGPoint(x: w * 0.4, y: h * 0.4))
                        path.addLine(to: CGPoint(x: w * 0.6, y: h * 0.7))
                    }
                    .stroke(.orange, lineWidth: 2)
                    Path { path in
                        path.move(to: CGPoint(x: w * 0.6, y: h * 0.7))
                        path.addLine(to: CGPoint(x: w * 0.72, y: h))
                    }
                    .stroke(.red, style: StrokeStyle(lineWidth: 1.5, dash: [2, 2]))
                    Rectangle().fill(.blue).frame(width: 1.5, height: h).position(x: w * 0.97, y: h / 2)
                }
                .frame(height: 26)
            }
        }
    }

    private func row(fill: Double, color: Color) -> some View {
        HStack(spacing: 6) {
            Capsule().fill(.quaternary).frame(height: 5)
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary)
                Capsule().fill(color).frame(width: 30 * fill)
            }
            .frame(width: 30, height: 4)
        }
    }

    private func track(fill: Double, tick: Double, color: Color) -> some View {
        GeometryReader { proxy in
            let w = proxy.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(.quaternary).frame(height: 5)
                Capsule().fill(color).frame(width: w * fill, height: 5)
                Rectangle().fill(.primary).frame(width: 2, height: 10).offset(x: w * tick)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 10)
    }
}
