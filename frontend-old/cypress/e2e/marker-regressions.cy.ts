const user = { publicId: 'owner-test', username: 'owner', email: 'owner@example.com' }
const marker = {
    id: 201,
    lat: 39.9042,
    lng: 116.4074,
    title: 'Regression marker',
    description: 'Full marker details',
    category: 'accessible_toilet',
    isPublic: true,
    isActive: true,
    reviewStatus: 'APPROVED',
    username: user.username,
    userPublicId: user.publicId,
}
const privateMarker = { ...marker, title: 'Private pending point', isPublic: false, reviewStatus: 'PENDING' }

const disableLocation = (win: Window) => {
    Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        value: { watchPosition: () => 1, clearWatch: () => undefined },
    })
}

describe('Marker detail and privacy regressions', () => {
    beforeEach(() => {
        cy.intercept('GET', '/api/me', { body: { data: null } })
        cy.intercept('GET', '/api/markers/viewport*', { body: [] }).as('viewport')
        cy.intercept({ method: 'GET', pathname: '/api/markers/me/created' }, { body: [] })
        cy.intercept('GET', '/api/markers/me/favorites', { body: [] })
    })

    it('renders an untrusted URL title as text without executing HTML', () => {
        const title = '<img src=x onerror="document.documentElement.dataset.xssProbe=1">'
        cy.visit(`/maps?lat=39.9&lng=116.4&title=${encodeURIComponent(title)}`, { onBeforeLoad: disableLocation })
        cy.get('.leaflet-popup-content').should('contain.text', title)
        cy.get('.leaflet-popup-content img').should('not.exist')
        cy.get('html').should('not.have.attr', 'data-xss-probe')
    })

    it('opens the owner private pending detail and clears it on logout', () => {
        cy.viewport(390, 844)
        let loggedIn = true
        cy.intercept('GET', '/api/me', (req) => req.reply({ data: loggedIn ? user : null }))
        cy.intercept({ method: 'GET', pathname: '/api/markers/me/created' }, { body: [privateMarker] })
        cy.intercept({ method: 'GET', pathname: '/api/markers/201' }, (req) => req.reply(loggedIn
            ? { statusCode: 200, body: privateMarker }
            : { statusCode: 404, body: '点位不存在' })).as('detail')
        cy.intercept('POST', '/api/logout', (req) => {
            loggedIn = false
            req.reply({ statusCode: 200, body: {} })
        }).as('logout')
        cy.visit('/maps?markerId=201', { onBeforeLoad: disableLocation })
        cy.wait('@detail')
        cy.get('.leaflet-popup-content').should('contain.text', privateMarker.title)
        cy.get('button[aria-label="编辑点位"]').should('be.visible')
        cy.get('button[aria-label="打开个人导航菜单"]').click()
        cy.contains('退出登录').click()
        cy.wait('@logout')
        cy.get('.leaflet-popup-content').should('not.exist')
        cy.get('.leaflet-marker-icon').should('not.exist')
    })

    it('loads private and pending points for the My points filter', () => {
        cy.intercept('GET', '/api/me', { body: { data: user } })
        cy.intercept({ method: 'GET', pathname: '/api/markers/me/created' }, { body: [privateMarker] }).as('created')
        cy.visit('/maps', { onBeforeLoad: disableLocation })
        cy.wait('@created')
        cy.contains('筛选点位').click()
        cy.contains('我添加的').click()
        cy.get('.leaflet-marker-icon').should('have.length', 1).click()
        cy.get('.leaflet-popup-content').should('contain.text', privateMarker.title)
    })

    it('discards a delayed private detail when another tab logs out', () => {
        let loggedIn = true
        let detailStarted = false
        cy.intercept('GET', '/api/me', (req) => req.reply({ data: loggedIn ? user : null }))
        cy.intercept({ method: 'GET', pathname: '/api/markers/201' }, (req) => {
            detailStarted = true
            req.reply(loggedIn
                ? { delay: 800, body: privateMarker }
                : { statusCode: 404, body: '点位不存在' })
        })
        cy.visit('/maps?markerId=201', { onBeforeLoad: disableLocation })
        cy.wrap(null).should(() => expect(detailStarted).to.equal(true))
        cy.window().then((win) => {
            loggedIn = false
            win.localStorage.removeItem('lycoris.auth.user.v1')
            win.dispatchEvent(new win.StorageEvent('storage', { key: 'lycoris.auth.user.v1', newValue: null }))
        })
        cy.wait(900)
        cy.get('.leaflet-popup-content').should('not.exist')
        cy.get('.leaflet-marker-icon').should('not.exist')
    })

    it('shows an unavailable detail message for a denied private point', () => {
        cy.intercept({ method: 'GET', pathname: '/api/markers/201' }, { statusCode: 404, body: '点位不存在' })
        cy.visit('/maps?markerId=201', { onBeforeLoad: disableLocation })
        cy.contains('无法打开此点位').should('be.visible')
        cy.get('.leaflet-popup-content').should('not.exist')
    })

    it('opens an offscreen nearby result on the first click before viewport data arrives', () => {
        const nearbyMarker = { ...marker, lat: 39.95, title: 'Offscreen nearby point' }
        cy.intercept('GET', '/api/markers/viewport*', { delay: 1200, body: [] })
        cy.intercept('GET', '/api/markers/nearby*', { delay: 200, body: [nearbyMarker] }).as('nearby')
        cy.visit('/maps', {
            onBeforeLoad(win) {
                Object.defineProperty(win.navigator, 'geolocation', {
                    configurable: true,
                    value: {
                        watchPosition(success: PositionCallback) {
                            success({ coords: { latitude: 39.9042, longitude: 116.4074 } } as GeolocationPosition)
                            return 1
                        },
                        clearWatch: () => undefined,
                    },
                })
            },
        })
        cy.contains('button', '附近无障碍卫生间').should('not.be.disabled').click()
        cy.wait('@nearby')
        cy.contains(nearbyMarker.title).click()
        cy.get('.leaflet-popup-content').should('contain.text', nearbyMarker.title)
        cy.get('.leaflet-popup-content').should('contain.text', nearbyMarker.description)
    })

    ;[375, 768, 1280, 1920].forEach((width) => {
        it(`keeps focused details clear of the navigation at ${width}px`, () => {
            cy.viewport(width, 844)
            cy.intercept({ method: 'GET', pathname: '/api/markers/201' }, { body: marker })
            cy.visit('/maps?markerId=201', { onBeforeLoad: disableLocation })
            cy.get('.leaflet-popup-content').should('contain.text', marker.title)
            cy.contains('我知道了').should('not.exist')
            cy.get('header').then(($header) => {
                const navBottom = $header[0].getBoundingClientRect().bottom
                cy.get('.leaflet-popup').should(($popup) => {
                    expect($popup[0].getBoundingClientRect().top).to.be.at.least(navBottom + 64)
                })
            })
            cy.get('.leaflet-popup-close-button').should('be.visible')
            cy.screenshot(`marker-detail-${width}`, { capture: 'viewport' })
        })
    })
})

describe('Search request ordering', () => {
    beforeEach(() => {
        cy.intercept('GET', '/api/me', { body: { data: null } })
    })

    it('keeps the latest results when an earlier query responds later', () => {
        let oldStarted = false
        cy.intercept('GET', '/api/markers/search*', (req) => {
            if (req.query.q === 'old') {
                oldStarted = true
                req.reply({ delay: 1000, body: [{ ...marker, title: 'Obsolete result' }] })
            } else {
                req.reply({ body: [{ ...marker, title: 'Latest result' }] })
            }
        })
        cy.visit('/search?q=old')
        cy.wrap(null).should(() => expect(oldStarted).to.equal(true))
        cy.get('input[aria-label="搜索关键词"]').clear().type('new')
        cy.contains('Latest result').should('be.visible')
        cy.wait(1100)
        cy.contains('Obsolete result').should('not.exist')
        cy.contains('Latest result').should('be.visible')
    })

    it('does not repopulate a cleared query and reports request failure separately', () => {
        let started = false
        cy.intercept('GET', '/api/markers/search*', (req) => {
            if (req.query.q === 'old') {
                started = true
                req.reply({ delay: 800, body: [{ ...marker, title: 'Obsolete result' }] })
            } else req.reply({ statusCode: 503, body: {} })
        })
        cy.visit('/search?q=old')
        cy.wrap(null).should(() => expect(started).to.equal(true))
        cy.get('input[aria-label="搜索关键词"]').clear()
        cy.wait(900)
        cy.contains('Obsolete result').should('not.exist')
        cy.get('input[aria-label="搜索关键词"]').type('failure')
        cy.contains('点位搜索失败').should('be.visible')
        cy.contains('暂无点位匹配').should('not.exist')
    })
})
