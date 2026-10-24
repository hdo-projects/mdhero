# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in MDHero, please report it responsibly.

**Email:** vaibhavuk.dev@gmail.com

Please do **not** open a public issue for security vulnerabilities.

I will acknowledge your report within 48 hours and work with you to address the issue.

## Scope

MDHero runs locally on your machine. It does not collect data, require accounts, or communicate with external servers except for:

- **Update check:** Once per 24 hours, MDHero asks GitHub for the latest release (`https://api.github.com/repos/vaibhav-kakde-in/mdhero/releases/latest`) and compares it with your installed version on your own machine. The request carries nothing about you: no version, no OS, no device ID. As with any web request, GitHub sees your IP address; see [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). To stop the automatic check, turn off **Settings → Check for updates automatically**; **Check for Updates…** in the app menu still works when you ask. When you choose **Update now**, the update is downloaded from GitHub Releases and its signature is verified before it installs.
- **Open URL:** When you explicitly paste a URL, MDHero fetches the raw content from that URL.

Both of these are user-initiated or clearly disclosed.

**Earlier versions.** MDHero 0.2.1 to 0.2.10 were built to send the update check to `mdhero.app/api/version` instead, with your MDHero version and OS family as URL parameters. That endpoint counted the requests per day, in aggregate (one count per version and one per OS, kept for up to a year). It stored no IP addresses and no device IDs. The app no longer makes that request, and the counting has been removed ([#180](https://github.com/vaibhav-kakde-in/mdhero/issues/180)).

File reads, writes (from the in-app editor), and rendering all happen locally. Your files never leave your machine.
