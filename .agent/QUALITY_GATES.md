# Quality Gates Policy

- Every configured check in `.factory/config.json` must pass on clean `HEAD` before approval.
- Missing tools or unconfigured checks report `NOT VERIFIED` and block release.
- Secret filenames and content scans must pass with 0 critical/high findings.
