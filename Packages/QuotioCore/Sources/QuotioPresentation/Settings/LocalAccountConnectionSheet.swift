import QuotioApplication
import QuotioDomain
import SwiftUI

/// Registers a provider login kept in a custom config directory, such as `CLAUDE_CONFIG_DIR`.
struct LocalAccountConnectionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let provider: QuotaProvider
    let providerName: String
    let source: MonitoringProvider.ConfigDirectorySource
    let onSave: (_ label: String?, _ directory: String) async throws -> Void

    @State private var label = ""
    @State private var directory = ""
    @State private var choosingFolder = false
    @State private var errorMessage: String?
    @State private var isSaving = false

    private var trimmedDirectory: String { directory.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                ProviderIcon(provider: provider, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(format: "settings.localAccount.title".localized(), providerName))
                        .font(.headline)
                    Text("settings.localAccount.subtitle".localized())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(20)

            Divider()

            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("settings.localAccount.displayName".localized())
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    TextField("settings.apiKey.label.placeholder".localized(), text: $label)
                        .textFieldStyle(.roundedBorder)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(String(format: "settings.localAccount.path".localized(), source.environmentVariable))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    HStack {
                        TextField("~/." + provider.rawValue + "-work", text: $directory)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.body, design: .monospaced))
                        Button("settings.localAccount.choose".localized()) { choosingFolder = true }
                    }
                    Text(helpText)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(24)

            Spacer(minLength: 0)
            Divider()

            HStack {
                Button("action.cancel".localized()) { dismiss() }
                Spacer()
                Button("settings.localAccount.add".localized()) {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(trimmedDirectory.isEmpty || isSaving)
            }
            .padding(20)
        }
        .frame(width: 450, height: 400)
        .fileImporter(isPresented: $choosingFolder, allowedContentTypes: [.folder]) { result in
            guard case .success(let url) = result else { return }
            directory = Self.abbreviatingHome(url.path)
        }
    }

    private var helpText: String {
        let key = "settings.localAccount.help." + source.environmentVariable
        let text = key.localized()
        return text == key ? "settings.localAccount.help".localized() : text
    }

    /// Writes the home folder as `~`, the form users export and the server expands.
    static func abbreviatingHome(_ path: String) -> String {
        (path as NSString).abbreviatingWithTildeInPath
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        errorMessage = nil
        let name = label.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await onSave(name.isEmpty ? nil : name, trimmedDirectory)
            dismiss()
        } catch let failure as LocalAccountFailure {
            errorMessage = failure.message
        } catch {
            errorMessage = LocalAccountFailure.unknown.message
        }
    }
}

@MainActor
extension LocalAccountFailure {
    var message: String {
        let key: String = switch self {
        case .invalidInput: "settings.localAccount.failure.invalidInput"
        case .notSignedIn: "settings.localAccount.failure.notSignedIn"
        case .duplicateAccount: "settings.localAccount.failure.duplicate"
        case .keychainAccess: "settings.permissionFailure.source"
        case .invalidCredential: "settings.localAccount.failure.invalidCredential"
        case .unknown: "settings.localAccount.failure.unknown"
        }
        return key.localizedStatic()
    }
}
