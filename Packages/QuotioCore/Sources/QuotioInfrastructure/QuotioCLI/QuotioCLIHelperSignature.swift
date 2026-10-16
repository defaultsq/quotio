import Foundation
import Security

public enum QuotioCLIHelperSignature {
    private static let developerIDIntermediateMarker = "1.2.840.113635.100.6.2.6"
    private static let standaloneCLIRequirement =
        #"identifier "dev.quotio.cli" and anchor apple generic and certificate 1[field.\#(developerIDIntermediateMarker)] exists"#

    public static func matchesStandaloneCLI(at url: URL) -> Bool {
        var code: SecStaticCode?
        var requirement: SecRequirement?
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess,
              let code,
              SecRequirementCreateWithString(standaloneCLIRequirement as CFString, [], &requirement) == errSecSuccess,
              let requirement else {
            return false
        }
        return SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess
    }
}
