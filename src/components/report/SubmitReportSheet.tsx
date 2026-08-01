/**
 * Web stub. The signature canvas is WebView-backed (native-only); the web
 * build is an online-only smoke target with no submit UI in M4a. Metro's
 * platform resolution picks the .native.tsx sibling on device.
 */
type Props = {
  readonly visible: boolean;
  readonly defaultSignerTitle: string | null;
  readonly onSubmit: (input: { signerTitle: string | null; signaturePngBase64: string }) => void;
  readonly onClose: () => void;
  readonly submitting: boolean;
  readonly errorText: string | null;
};

export function SubmitReportSheet(_props: Props): null {
  return null;
}
