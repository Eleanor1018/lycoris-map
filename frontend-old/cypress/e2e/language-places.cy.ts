const owner = { publicId: 'locale-owner', username: 'locale', email: 'locale@example.com' }
const point = {
    id: 501, lat: 39.9042, lng: 116.4074, category: 'accessible_toilet',
    title: 'Accessible toilet', description: 'Entrance next to Exit A', isPublic: true,
    isActive: true, reviewStatus: 'APPROVED', userPublicId: owner.publicId, username: owner.username,
    sourceLanguage: 'zh', contentLanguage: 'en',
}
const setupWindow = (win: Window, preference = 'en', systemLanguage = 'en-US') => {
    win.localStorage.setItem('lycoris.language', preference)
    win.localStorage.setItem('map.addMarkerHintSeen', '1')
    Object.defineProperty(win.navigator, 'language', { configurable: true, value: systemLanguage })
    Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true, value: { watchPosition: () => 1, clearWatch: () => undefined },
    })
}
const selectLanguage = (label: string) => {
    const targetLanguage = label === 'English' ? 'en' : 'zh-CN'
    cy.get('html').then(($html) => {
        if ($html.attr('lang') === targetLanguage) return
        const action = label === 'English' ? '切换到英文' : 'Switch to Chinese'
        cy.get(`header button[aria-label="${action}"]`).filter(':visible').click()
    })
    cy.get('html').should('have.attr', 'lang', targetLanguage)
}

describe('Localized places and shared navigation', () => {
    beforeEach(() => {
        cy.viewport(1280, 900)
        cy.intercept('GET', '/api/me', { body: { data: owner } })
        cy.intercept('GET', '/api/markers/viewport*', { body: [] }).as('viewport')
        cy.intercept('GET', '/api/markers/me/created*', { body: [] })
        cy.intercept('GET', '/api/markers/me/favorites', { body: [] })
        cy.intercept('GET', '/api/markers/me/favorites/details*', { body: [] })
    })

    it('follows English system language and falls back to Chinese for unsupported locales', () => {
        cy.visit('/maps', { onBeforeLoad: (win) => setupWindow(win, 'system', 'en-GB') })
        cy.get('button[aria-label="Add place"]').should('be.visible')
        cy.wait('@viewport').its('request.query.lang').should('equal', 'en')
        cy.visit('/maps', { onBeforeLoad: (win) => setupWindow(win, 'system', 'fr-FR') })
        cy.get('button[aria-label="添加标记点"]').should('be.visible')
        cy.wait('@viewport').its('request.query.lang').should('equal', 'zh')
    })

    it('falls back to Chinese and allows in-memory language changes when storage is denied', () => {
        cy.visit('/search', { onBeforeLoad(win) {
            setupWindow(win, 'system', 'en-US')
            Object.defineProperty(win, 'localStorage', { configurable: true, get() {
                throw new DOMException('Storage denied', 'SecurityError')
            } })
        } })
        cy.get('html').should('have.attr', 'lang', 'zh-CN')
        cy.get('input[aria-label="搜索关键词"]').should('be.visible')
        selectLanguage('English')
        cy.get('html').should('have.attr', 'lang', 'en')
        cy.get('input[aria-label="Search keywords"]').should('be.visible')
    })

    it('opens a language link and permits switching when preference writes fail', () => {
        cy.visit('/search?lang=en', { onBeforeLoad(win) {
            setupWindow(win, 'zh')
            cy.stub(win.localStorage, 'setItem').throws(new DOMException('Storage denied', 'SecurityError')).as('storePreference')
        } })
        cy.get('@storePreference').should('have.been.calledWith', 'lycoris.language', 'en')
        cy.get('html').should('have.attr', 'lang', 'en')
        selectLanguage('中文')
        cy.get('@storePreference').should('have.been.calledWith', 'lycoris.language', 'zh')
        cy.location('search').should('not.include', 'lang=en')
        cy.get('html').should('have.attr', 'lang', 'zh-CN')
        cy.get('input[aria-label="搜索关键词"]').should('be.visible')
    })

    it('uses a shared language override and copies a link without private content', () => {
        cy.intercept({ method: 'GET', pathname: '/api/markers/501' }, { body: { ...point, isPublic: false } }).as('detail')
        cy.visit('/maps?markerId=501&lang=en', { onBeforeLoad(win) {
            setupWindow(win, 'zh')
            Object.defineProperty(win.navigator, 'share', { configurable: true, value: undefined })
            Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: cy.stub().resolves().as('copy') } })
        } })
        cy.wait('@detail').its('request.query.lang').should('equal', 'en')
        cy.get('.leaflet-popup-content').should('contain.text', point.title)
        cy.get('.leaflet-popup-content a').contains('Directions').should('have.attr', 'href')
            .and('include', 'destination=39.9042%2C116.4074')
        cy.get('.leaflet-popup-content').contains('button', 'Share').click({ scrollBehavior: false })
        cy.get('@copy').should('have.been.calledOnceWithExactly', 'http://127.0.0.1:5193/maps?markerId=501&lang=en')
        cy.contains('Link copied').should('be.visible')
        selectLanguage('中文')
        cy.location('search').should('not.include', 'lang=en')
        cy.get('button[aria-label="添加标记点"]').should('be.visible')
    })

    it('discards a delayed private detail and viewport from the previous language', () => {
        let started = false
        cy.intercept({ method: 'GET', pathname: '/api/markers/501' }, (req) => {
            if (req.query.lang === 'zh') {
                started = true
                req.reply({ delay: 1200, body: { ...point, title: '旧私有点位', isPublic: false, contentLanguage: 'zh' } })
            } else req.reply({ body: { ...point, title: 'Current private place', isPublic: false } })
        })
        cy.intercept('GET', '/api/markers/viewport*', (req) => req.reply(req.query.lang === 'zh'
            ? { delay: 1200, body: [{ ...point, id: 502, title: '旧地图点位' }] } : { body: [] }))
        cy.visit('/maps?markerId=501', { onBeforeLoad: (win) => setupWindow(win, 'zh') })
        cy.wrap(null).should(() => expect(started).to.equal(true))
        selectLanguage('English')
        cy.get('.leaflet-popup-content').should('contain.text', 'Current private place')
        cy.wait(1400)
        cy.contains('旧私有点位').should('not.exist')
        cy.get('.leaflet-marker-icon').should('have.length', 1)
    })

    it('ignores old-language search responses and requests translated personal lists', () => {
        let started = false
        cy.intercept('GET', '/api/markers/search*', (req) => {
            if (req.query.lang === 'zh') { started = true; req.reply({ delay: 1200, body: [{ ...point, title: '旧搜索结果' }] }) }
            else req.reply({ body: [point] })
        })
        cy.visit('/search?q=toilet', { onBeforeLoad: (win) => setupWindow(win, 'zh') })
        cy.wrap(null).should(() => expect(started).to.equal(true))
        selectLanguage('English')
        cy.contains(point.title).should('be.visible')
        cy.wait(1400)
        cy.contains('旧搜索结果').should('not.exist')
        cy.intercept('GET', '/api/markers/me/created*', { body: [point] }).as('created')
        cy.intercept('GET', '/api/markers/me/favorites/details*', { body: [point] }).as('favorites')
        cy.visit('/me')
        cy.wait('@created').its('request.query.lang').should('equal', 'en')
        cy.wait('@favorites').its('request.query.lang').should('equal', 'en')
        cy.contains('Created places').should('be.visible')
        cy.contains('Favorite places').should('be.visible')
        cy.contains(point.title).should('be.visible')
    })

    it('submits the selected language for both creation and translation edits', () => {
        cy.intercept({ method: 'POST', pathname: '/api/markers' }, { body: point }).as('create')
        cy.visit('/maps', { onBeforeLoad: (win) => setupWindow(win) })
        cy.get('button[aria-label="Add place"]').click()
        cy.get('.leaflet-container').click(520, 340)
        cy.get('.MuiDialog-root').should('contain.text', 'Writing in: English')
        cy.get('.MuiDialog-root input').filter('[placeholder="e.g. Accessible toilet at Exit A"]').type('New English place')
        cy.get('.MuiDialog-root').contains('button', 'Save').click()
        cy.wait('@create').its('request.body').should('include', { language: 'en', title: 'New English place' })
        cy.intercept({ method: 'GET', pathname: '/api/markers/501' }, { body: { ...point, title: '中文原文', contentLanguage: 'zh' } })
        cy.intercept({ method: 'PATCH', pathname: '/api/markers/501' }, { body: point }).as('edit')
        cy.visit('/maps?markerId=501&lang=en', { onBeforeLoad: (win) => setupWindow(win) })
        cy.get('.leaflet-popup-content').should('contain.text', 'Showing the Chinese original')
        cy.get('button[aria-label="Edit place"]').click({ scrollBehavior: false })
        cy.get('.MuiDialog-root').should('contain.text', 'Translate the original into this language before saving.')
        cy.get('.MuiDialog-root input').filter('[placeholder="e.g. Accessible toilet at Exit A"]').clear().type('Translated place')
        cy.get('.MuiDialog-root').contains('button', 'Save').click()
        cy.wait('@edit').its('request.body').should('include', { language: 'en', title: 'Translated place' })
    })

    it('uses native sharing and offers manual copying when clipboard access fails', () => {
        cy.intercept({ method: 'GET', pathname: '/api/markers/501' }, { body: point })
        cy.visit('/maps?markerId=501&lang=en', { onBeforeLoad(win) {
            setupWindow(win)
            Object.defineProperty(win.navigator, 'share', { configurable: true, value: cy.stub().rejects(new Error('Unavailable')).as('share') })
            Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: cy.stub().rejects(new Error('Denied')) } })
        } })
        cy.get('.leaflet-popup-content').contains('button', 'Share').click({ scrollBehavior: false })
        cy.get('@share').should('have.been.calledOnce')
        cy.get('.MuiDialog-root input').should('have.value', 'http://127.0.0.1:5193/maps?markerId=501&lang=en')
    })

    it('does not save fallback source text as a translation when only metadata changes', () => {
        cy.intercept({ method: 'GET', pathname: '/api/markers/501' }, { body: { ...point, title: '中文原文', contentLanguage: 'zh' } })
        cy.intercept({ method: 'PATCH', pathname: '/api/markers/501' }, { body: point }).as('metadata')
        cy.visit('/maps?markerId=501&lang=en', { onBeforeLoad: (win) => setupWindow(win) })
        cy.get('button[aria-label="Edit place"]').click({ scrollBehavior: false })
        cy.get('.MuiDialog-root').contains('Share publicly').click()
        cy.get('.MuiDialog-root').contains('button', 'Save').click()
        cy.wait('@metadata').then(({ request }) => {
            expect(request.query.lang).to.equal('en')
            expect(request.body).to.include({ language: 'en', isPublic: false })
            expect(request.body).not.to.have.property('title')
            expect(request.body).not.to.have.property('description')
        })
    })

    it('clears an in-flight nearby search when changing language', () => {
        let started = false
        cy.intercept('GET', '/api/markers/nearby*', (req) => {
            if (req.query.lang === 'zh') { started = true; req.reply({ delay: 1200, body: [{ ...point, title: '旧附近结果' }] }) }
            else req.reply({ body: [{ ...point, title: 'Nearby English place' }] })
        }).as('nearby')
        cy.visit('/maps', { onBeforeLoad(win) {
            setupWindow(win, 'zh')
            Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: {
                watchPosition(success: PositionCallback) {
                    success({ coords: { latitude: point.lat, longitude: point.lng } } as GeolocationPosition)
                    return 1
                }, clearWatch: () => undefined,
            } })
        } })
        cy.contains('button', '附近无障碍卫生间').should('not.be.disabled').click()
        cy.wrap(null).should(() => expect(started).to.equal(true))
        selectLanguage('English')
        cy.wait(1400)
        cy.contains('旧附近结果').should('not.exist')
        cy.contains('button', 'Nearby Accessible toilet').should('not.be.disabled').click()
        cy.contains('Nearby English place').click()
        cy.get('.leaflet-popup-content').should('contain.text', point.description)
    })

    ;[375, 768, 1280, 1920].forEach((width) => {
        it(`keeps English marker actions usable at ${width}px`, () => {
            cy.viewport(width, 844)
            cy.intercept({ method: 'GET', pathname: '/api/markers/501' }, { body: point })
            cy.visit('/maps?markerId=501&lang=en', { onBeforeLoad: (win) => setupWindow(win) })
            cy.get('.leaflet-popup-content').should('contain.text', point.title)
            cy.get('.leaflet-popup-content a').contains('Directions').should('be.visible')
            cy.get('.leaflet-popup-content').contains('button', 'Share').should('be.visible')
            cy.get('header').then(($header) => {
                const navBottom = $header[0].getBoundingClientRect().bottom
                cy.get('.leaflet-popup').should(($popup) => expect($popup[0].getBoundingClientRect().top).to.be.at.least(navBottom + 64))
            })
            cy.screenshot(`english-marker-${width}`, { capture: 'viewport' })
        })
    })
})
