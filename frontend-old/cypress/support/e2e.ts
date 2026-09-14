// Cypress support file for global hooks and custom commands.
// Existing scenarios use Chinese. Locale scenarios explicitly override this preference.
Cypress.on('window:before:load', (win) => {
    if (!win.localStorage.getItem('lycoris.language')) win.localStorage.setItem('lycoris.language', 'zh')
})
export {}
