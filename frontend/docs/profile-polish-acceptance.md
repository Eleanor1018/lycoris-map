# Profile layout polish — 2026-09-17

Branch: `deploy/lycoris-map-com`. Status: locally verified, not deployed.

The profile header now shows the saved nickname and email beside the 44px
avatar, with Change avatar below. The nickname uses the former Change avatar
typography (17px/22px); the email uses a quieter 15px/20px subtitle. A missing
nickname uses the localized Account label. The username is omitted from the
profile header. Long text wraps without shrinking the avatar.

Change Password, My Places and Administration share one rounded list, with
inset separators and aligned rows. Administration follows the personal options;
its link now has the same vertical alignment as the buttons. The existing
server-confirmed admin visibility check is unchanged. Logout remains a separate
row below the list. Chevrons reuse the existing desktop/mobile Settings assets
and dimensions. Row text aligns with the text inside the profile inputs.

Verification:

- All 22 existing account-flow and administration tests passed.
- Strict TypeScript checks, production build, formatting and diff checks passed.
- Computer Use checked the built app with a synthetic account on port 4177 at
  desktop 1280×720 and mobile 390×844, in English and Chinese.
- Desktop input and list text both start at x=475.5px; all chevrons are 7×12px
  at x=797px. At 390px, text starts at x=23px and all mobile chevrons use the
  existing 9×32px asset box at x=358.5px. Logout is outside the grouped list.
- At 320×667, a long nickname wraps, the avatar stays 44px, and the scroll
  container has equal client/scroll widths (320px). Scrolling reaches Logout.
  A synthetic non-admin account does not show Administration. Change Password
  still opens the password form.
- The viewport override was reset. No real account, password, avatar or
  production data was changed. Physical devices were not tested.

Production follow-up: deployed on 2026-09-17 in release
`e0c442e4-8654-4728-86f8-70c7786c1bec`; see `deploy/cloudflare/README.md`.
