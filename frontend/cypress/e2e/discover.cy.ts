const origin = { lat: 31.2304, lng: 121.4737 }
const picture =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#d0bcff"/></svg>'
    )
const base = {
    ...origin,
    isPublic: true,
    isActive: true,
    description: 'Entrance next to the lift',
    markImage: picture,
}
const places = [
    {
        ...base,
        id: 2,
        lat: origin.lat + 0.02,
        category: 'friendly_clinic',
        title: 'Clinic',
        markImage: null,
    },
    {
        ...base,
        id: 1,
        lat: origin.lat + 0.001,
        category: 'accessible_toilet',
        title: '近处卫生间',
    },
    {
        ...base,
        id: 3,
        lat: origin.lat + 0.002,
        category: 'baby_room',
        title: '母婴室',
        markImage: null,
    },
    {
        ...base,
        id: 4,
        category: 'accessible_toilet',
        title: 'Private',
        isPublic: false,
    },
    {
        ...base,
        id: 5,
        lat: origin.lat + 0.08,
        category: 'accessible_toilet',
        title: 'Too far',
    },
    {
        ...base,
        id: 6,
        lat: origin.lat + 0.003,
        category: 'self_definition',
        title: 'Broken photo',
        markImage: '/uploads/missing.jpg',
    },
]
function setupWindow(
    win: Window,
    locate?: (
        success: PositionCallback,
        error?: PositionErrorCallback | null
    ) => void
) {
    win.localStorage.setItem('lycoris.language', 'zh')
    win.localStorage.setItem(
        'map.lastView',
        JSON.stringify({ ...origin, zoom: 14 })
    )
    win.localStorage.setItem('map.addMarkerHintSeen', '1')
    Object.defineProperty(win.navigator, 'geolocation', {
        configurable: true,
        value: {
            getCurrentPosition:
                locate ??
                ((_success: PositionCallback, error?: PositionErrorCallback) =>
                    error?.({
                        code: 1,
                        message: 'Denied',
                    } as GeolocationPositionError)),
            watchPosition: () => 1,
            clearWatch: () => undefined,
        },
    })
}
function mockPlaces() {
    cy.intercept('GET', '/api/markers/nearby*', (req) =>
        req.reply({
            body: places.filter((p) => p.category === req.query.category),
        })
    ).as('nearby')
}
function visit() {
    cy.visit('/discover?lang=zh', { onBeforeLoad: setupWindow })
}
function expectIds(ids: number[]) {
    cy.get('[data-testid="discover-card"]').should(($cards) => {
        expect(
            [...$cards].map((card) => Number(card.dataset.markerId))
        ).to.deep.equal(ids)
    })
}

describe('Discover nearby places', () => {
    beforeEach(() => {
        cy.viewport(1280, 900)
        cy.intercept('GET', '/api/me', { statusCode: 401, body: {} })
        cy.intercept('GET', '/uploads/missing.jpg', {
            statusCode: 404,
            body: '',
        })
        cy.intercept('GET', '/api/markers/viewport*', { body: [] })
        mockPlaces()
    })

    it('uses the saved map center, sorts real distances, and excludes private/out-of-radius points', () => {
        visit()
        expectIds([1, 3, 6, 2])
        cy.get('.discover-page h1').should('have.text', '附近点位')
        cy.wait('@nearby')
            .its('request.query')
            .should('include', {
                lat: String(origin.lat),
                lng: String(origin.lng),
                radius: '5000',
                lang: 'zh',
            })
        cy.get('[data-marker-id="1"]').should('contain.text', '111 m')
        cy.get('header')
            .should('contain.text', '发现')
            .and('not.contain.text', '文档')
    })

    it('filters from the category dropdown and search, and resets empty results', () => {
        visit()
        expectIds([1, 3, 6, 2])
        cy.get('[role="combobox"][aria-label="点位类别"]').click()
        cy.get('[role="option"]').contains('友好医疗机构').click()
        expectIds([2])
        cy.get('.discover-search input').type('nothing-matches')
        cy.contains('这里暂时没有符合条件的点位').should('be.visible')
        cy.contains('button', '重置筛选').click()
        expectIds([1, 3, 6, 2])
        cy.get('.discover-search input').type('卫生间')
        expectIds([1])
        cy.get('.discover-search input').clear()
        expectIds([1, 3, 6, 2])
    })

    it('shows photo fallbacks and opens a full photo preview', () => {
        visit()
        cy.get('[data-marker-id="3"]').should('contain.text', '暂无照片')
        cy.get('[data-marker-id="6"]').should('contain.text', '暂无照片')
        cy.get('[data-marker-id="1"] .discover-photo').click()
        cy.get('[role="dialog"]')
            .should('be.visible')
            .and('contain.text', '近处卫生间')
        cy.get('button[aria-label="关闭照片"]').click()
        cy.get('[role="dialog"]').should('not.exist')
    })

    it('preserves destination coordinates and opens the selected marker on the map', () => {
        cy.intercept('GET', '/api/markers/1?*', { body: places[1] }).as(
            'detail'
        )
        visit()
        cy.get('[data-marker-id="1"] a')
            .contains('导航')
            .should('have.attr', 'href')
            .and(
                'include',
                encodeURIComponent(`${places[1].lat},${places[1].lng}`)
            )
        cy.get('[data-marker-id="1"]').contains('a', '在地图上查看').click()
        cy.location('search')
            .should('include', 'markerId=1')
            .and('include', 'lang=zh')
        cy.wait('@detail')
        cy.get('.leaflet-popup-content').should('contain.text', '近处卫生间')
    })

    it('shows a recoverable request error and works after retry', () => {
        let failing = true
        cy.intercept('GET', '/api/markers/nearby*', (req) =>
            req.reply(
                failing
                    ? { statusCode: 500, body: {} }
                    : {
                          body: places.filter(
                              (p) => p.category === req.query.category
                          ),
                      }
            )
        )
        visit()
        cy.contains('暂时没能加载点位').should('be.visible')
        cy.then(() => {
            failing = false
        })
        cy.contains('button', '重新加载').click()
        expectIds([1, 3, 6, 2])
    })

    it('ignores delayed results after the category changes and reloads in English', () => {
        let fast = false
        let started = false
        cy.intercept('GET', '/api/markers/nearby*', (req) => {
            started = true
            req.reply({
                delay: fast ? 0 : 1200,
                body: [
                    {
                        ...places[1],
                        title: fast ? 'Current result' : 'Obsolete result',
                    },
                ],
            })
        })
        visit()
        cy.wrap(null).should(() => expect(started).to.equal(true))
        cy.then(() => {
            fast = true
        })
        cy.get('[role="combobox"][aria-label="点位类别"]').click()
        cy.get('[role="option"]').contains('无障碍卫生间').click()
        cy.get('[data-testid="discover-card"]').should(
            'contain.text',
            'Current result'
        )
        cy.wait(1300)
        cy.contains('Obsolete result').should('not.exist')
        cy.get('button[aria-label="切换到英文"]').click()
        cy.contains('h1', 'Nearby places').should('be.visible')
        cy.get('[role="combobox"][aria-label="Place type"]').should(
            'be.visible'
        )
    })

    it('opens Discover from the narrow-screen drawer, with the dropdown beside search and no overflow', () => {
        cy.viewport(320, 740)
        cy.visit('/maps?lang=zh', { onBeforeLoad: setupWindow })
        cy.get('button[aria-label="打开登录导航菜单"]').click()
        cy.get('.MuiDrawer-paper').contains('发现').click()
        cy.location('pathname').should('equal', '/discover')
        cy.get('[role="combobox"][aria-label="点位类别"]').click()
        cy.get('[role="option"]').contains('母婴室').click()
        expectIds([3])
        cy.get('.discover-controls').should(($controls) => {
            const search = $controls
                .find('.discover-search')[0]
                .getBoundingClientRect()
            const dropdown = $controls
                .find('.discover-category')[0]
                .getBoundingClientRect()
            expect(dropdown.left).to.be.greaterThan(search.right)
            expect(dropdown.top).to.equal(search.top)
        })
        cy.document().should((doc) =>
            expect(doc.documentElement.scrollWidth).to.be.at.most(320)
        )
        cy.get('[data-marker-id="3"]')
            .contains('a', '导航')
            .should('be.visible')
    })
})
