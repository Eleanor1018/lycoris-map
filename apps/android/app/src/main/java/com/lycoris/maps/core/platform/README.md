# Platform actions

`PlaceLink` validates shared place URLs for both cold starts and `onNewIntent`. Keep host, scheme, parameter, and ID validation together; optional link language does not change the device preference.

`PlaceSharing` opens the native Sharesheet. `NavigationLauncher` queries installed, enabled map handlers at tap time and uses an explicit chooser rather than remembering a default provider. Package visibility declarations in the manifest must match its supported handlers. A launched chooser is not proof that navigation succeeded.

When no map app is available, offer the validated HTTPS fallback as a separate user action. Recheck launch failures because an app can disappear between discovery and selection.

API/model coordinates remain WGS84. Convert only for the chosen provider's outgoing route. Keep the mainland coverage data and its bundled license; ambiguous coordinate-boundary picks must be rejected instead of saved with a guessed offset. Do not send the user's current coordinates when the chosen map app can obtain its own origin.

Unit tests cover URL and coordinate contracts. Device tests must cover real chooser presentation, provider launch, cold/warm links, and returning to the map.
