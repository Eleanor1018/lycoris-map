package com.lycoris.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lycoris.LycorisApplication;
import com.lycoris.entity.MapMarker;
import com.lycoris.entity.MarkerEditProposal;
import com.lycoris.repository.MapMarkerRepository;
import com.lycoris.repository.MarkerEditProposalRepository;
import com.lycoris.service.MapMarkerService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.jdbc.EmbeddedDatabaseConnection;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

/** Uses committed, overlapping transactions against a disposable H2 database only. */
@DataJpaTest(showSql = false, properties = {
        "spring.config.location=optional:classpath:/marker-approval-test-no-config.yml",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.database-platform=org.hibernate.dialect.H2Dialect",
        "spring.sql.init.mode=never",
        "cache.marker.redis-enabled=false",
        "admin.second-factor-enabled=false",
        "app.upload-dir=target/marker-approval-test-unused-uploads"
})
@AutoConfigureTestDatabase(connection = EmbeddedDatabaseConnection.H2,
        replace = AutoConfigureTestDatabase.Replace.ANY)
@ContextConfiguration(classes = LycorisApplication.class)
@Import({AdminMarkerController.class, MapMarkerService.class,
        MarkerApprovalPersistenceTest.JsonConfiguration.class})
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class MarkerApprovalPersistenceTest {

    @Autowired private MapMarkerRepository markerRepo;
    @Autowired private MarkerEditProposalRepository proposalRepo;
    @Autowired private MapMarkerService markerService;
    @Autowired private AdminMarkerController controller;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired private DataSource dataSource;

    private TransactionTemplate transaction;

    @BeforeEach
    void prepareIsolatedDatabase() throws Exception {
        // Fail before any fixture writes if test configuration ever stops selecting H2.
        try (Connection connection = dataSource.getConnection()) {
            assertThat(connection.getMetaData().getURL()).startsWith("jdbc:h2:mem:");
        }
        transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.executeWithoutResult(status -> {
            proposalRepo.deleteAllInBatch();
            markerRepo.deleteAllInBatch();
        });
    }

    @Test
    void staleMarkerMergeCannotOverwriteACommittedUpdate() {
        MapMarker original = markerRepo.saveAndFlush(marker());

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            MapMarker staleCopy = markerService.findById(original.getId()).orElseThrow();
            inTransaction(() -> {
                MapMarker winner = markerRepo.findById(original.getId()).orElseThrow();
                winner.setTitle("Committed marker title");
                winner.setDescription("Committed marker description");
                return markerRepo.saveAndFlush(winner);
            });
            staleCopy.setTitle("Stale marker title");
            staleCopy.setDescription("Stale marker description");
            markerService.save(staleCopy);
            markerRepo.flush();
        })).isInstanceOf(OptimisticLockingFailureException.class);

        MapMarker persisted = markerRepo.findById(original.getId()).orElseThrow();
        assertThat(persisted.getTitle()).isEqualTo("Committed marker title");
        assertThat(persisted.getDescription()).isEqualTo("Committed marker description");
        assertThat(persisted.getVersion()).isEqualTo(original.getVersion() + 1);
    }

    @Test
    void staleProposalUpdateCannotReplaceACommittedReview() {
        MapMarker marker = markerRepo.saveAndFlush(marker());
        MarkerEditProposal original = proposalRepo.saveAndFlush(proposal(marker, "Proposed title"));

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            MarkerEditProposal stale = proposalRepo.findById(original.getId()).orElseThrow();
            inTransaction(() -> {
                MarkerEditProposal winner = proposalRepo.findById(original.getId()).orElseThrow();
                winner.setStatus("REJECTED");
                winner.setReviewedBy("winning-reviewer");
                winner.setReviewedAt(Instant.now());
                return proposalRepo.saveAndFlush(winner);
            });
            stale.setStatus("APPROVED");
            stale.setReviewedBy("stale-reviewer");
            proposalRepo.saveAndFlush(stale);
        })).isInstanceOf(OptimisticLockingFailureException.class);

        MarkerEditProposal persisted = proposalRepo.findById(original.getId()).orElseThrow();
        assertThat(persisted.getStatus()).isEqualTo("REJECTED");
        assertThat(persisted.getReviewedBy()).isEqualTo("winning-reviewer");
        assertThat(persisted.getReviewedAt()).isNotNull();
        assertThat(persisted.getVersion()).isEqualTo(original.getVersion() + 1);
    }

    @Test
    void staleBaseVersionReturnsConflictWithoutOverwritingTheFirstApproval() {
        MapMarker marker = markerRepo.saveAndFlush(marker());
        MarkerEditProposal first = proposalRepo.saveAndFlush(proposal(marker, "First approved title"));
        MarkerEditProposal stale = proposalRepo.saveAndFlush(proposal(marker, "Stale proposed title"));

        assertThat(controller.approveEditProposal(first.getId(), reviewer("first-admin"))
                .getStatusCode()).isEqualTo(HttpStatus.OK);
        MapMarker approved = markerRepo.findById(marker.getId()).orElseThrow();
        MarkerEditProposal accepted = proposalRepo.findById(first.getId()).orElseThrow();

        ResponseEntity<?> response = controller.approveEditProposal(stale.getId(), reviewer("late-admin"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(markerRepo.findById(marker.getId()).orElseThrow())
                .usingRecursiveComparison().isEqualTo(approved);
        assertThat(proposalRepo.findById(first.getId()).orElseThrow())
                .usingRecursiveComparison().isEqualTo(accepted);
        assertThat(proposalRepo.findById(stale.getId()).orElseThrow())
                .usingRecursiveComparison().isEqualTo(stale);
    }

    @Test
    void historicalProposalWithoutBaseVersionReturnsConflictAndStaysPending() {
        MapMarker original = markerRepo.saveAndFlush(marker());
        MarkerEditProposal historical = proposal(original, "Historical proposed title");
        historical.setBaseMarkerVersion(null);
        historical = proposalRepo.saveAndFlush(historical);

        ResponseEntity<?> response = controller.approveEditProposal(historical.getId(), reviewer("admin"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(markerRepo.findById(original.getId()).orElseThrow())
                .usingRecursiveComparison().isEqualTo(original);
        assertThat(proposalRepo.findById(historical.getId()).orElseThrow())
                .usingRecursiveComparison().isEqualTo(historical);
    }

    @Test
    void currentProposalCommitsMarkerAndReviewTogether() {
        MapMarker original = markerRepo.saveAndFlush(marker());
        MarkerEditProposal proposal = proposalRepo.saveAndFlush(proposal(original, "Approved title"));

        ResponseEntity<?> response = controller.approveEditProposal(proposal.getId(), reviewer("approving-admin"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        MapMarker approved = markerRepo.findById(original.getId()).orElseThrow();
        assertThat(approved.getTitle()).isEqualTo(proposal.getTitle());
        assertThat(approved.getDescription()).isEqualTo(proposal.getDescription());
        assertThat(approved.getCategory()).isEqualTo(proposal.getCategory());
        assertThat(approved.getIsPublic()).isEqualTo(proposal.getIsPublic());
        assertThat(approved.getIsActive()).isEqualTo(proposal.getIsActive());
        assertThat(approved.getReviewStatus()).isEqualTo("APPROVED");
        assertThat(approved.getLastEditedBy()).isEqualTo(proposal.getProposerUsername());
        assertThat(approved.getLastEditedByPublicId()).isEqualTo(proposal.getProposerPublicId());
        assertThat(approved.getLastEditedByOwner()).isEqualTo(proposal.getProposerIsOwner());
        assertThat(approved.getVersion()).isEqualTo(original.getVersion() + 1);
        assertThat(response.getBody()).isInstanceOf(MapMarker.class);
        MapMarker responseMarker = (MapMarker) response.getBody();
        assertThat(responseMarker.getVersion()).isEqualTo(approved.getVersion());
        assertThat(responseMarker.getUpdatedAt()).isCloseTo(approved.getUpdatedAt(), within(1, ChronoUnit.MICROS));
        MarkerEditProposal reviewed = proposalRepo.findById(proposal.getId()).orElseThrow();
        assertThat(reviewed.getStatus()).isEqualTo("APPROVED");
        assertThat(reviewed.getReviewedBy()).isEqualTo("approving-admin");
        assertThat(reviewed.getReviewedAt()).isNotNull();
        assertThat(reviewed.getVersion()).isEqualTo(proposal.getVersion() + 1);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void concurrentApprovalAndRejectionPreserveOnlyTheWinningTransaction(boolean approvalWins) {
        MapMarker original = markerRepo.saveAndFlush(marker());
        MarkerEditProposal proposal = proposalRepo.saveAndFlush(proposal(original, "Approved during race"));

        // Suspend the first reader while a second transaction reviews and commits.
        // This forces an actual stale JPA version without timing-sensitive threads.
        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            MarkerEditProposal stale = proposalRepo.findById(proposal.getId()).orElseThrow();
            assertThat(stale.getStatus()).isEqualTo("PENDING");
            ResponseEntity<?> winner = inTransaction(() -> approvalWins
                    ? controller.approveEditProposal(proposal.getId(), reviewer("winning-admin"))
                    : controller.rejectEditProposal(proposal.getId(), reviewer("winning-admin")));
            assertThat(winner.getStatusCode()).isEqualTo(HttpStatus.OK);

            ResponseEntity<?> loser = approvalWins
                    ? controller.rejectEditProposal(proposal.getId(), reviewer("losing-admin"))
                    : controller.approveEditProposal(proposal.getId(), reviewer("losing-admin"));
            assertThat(loser.getStatusCode()).isEqualTo(HttpStatus.OK);
            proposalRepo.flush();
        })).isInstanceOf(OptimisticLockingFailureException.class);

        MarkerEditProposal reviewed = proposalRepo.findById(proposal.getId()).orElseThrow();
        assertThat(reviewed.getStatus()).isEqualTo(approvalWins ? "APPROVED" : "REJECTED");
        assertThat(reviewed.getReviewedBy()).isEqualTo("winning-admin");
        assertThat(reviewed.getVersion()).isEqualTo(proposal.getVersion() + 1);
        MapMarker persisted = markerRepo.findById(original.getId()).orElseThrow();
        if (approvalWins) {
            assertThat(persisted.getTitle()).isEqualTo(proposal.getTitle());
            assertThat(persisted.getVersion()).isEqualTo(original.getVersion() + 1);
        } else {
            // The losing approval must roll back its marker merge as well as its review.
            assertThat(persisted).usingRecursiveComparison().isEqualTo(original);
        }
    }

    @Test
    void readTimeNormalizationDoesNotDirtyMarkerOrAdvanceItsVersion() {
        MapMarker seed = marker();
        seed.setCategory("safe_place");
        seed.setIsActive(false);
        seed.setOpenTimeStart("00:00");
        seed.setOpenTimeEnd("00:00");
        MapMarker original = markerRepo.saveAndFlush(seed);

        inTransaction(() -> {
            MapMarker normalized = markerService.findById(original.getId()).orElseThrow();
            assertThat(normalized.getCategory()).isEqualTo("self_definition");
            assertThat(normalized.getIsActive()).isTrue();
            assertThat(normalized.getVersion()).isEqualTo(original.getVersion());
            markerRepo.flush();
            return normalized;
        });

        assertThat(markerRepo.findById(original.getId()).orElseThrow())
                .usingRecursiveComparison().isEqualTo(original);
    }

    private <T> T inTransaction(Supplier<T> work) {
        return transaction.execute(status -> work.get());
    }

    private static MapMarker marker() {
        MapMarker marker = new MapMarker();
        marker.setLat(22.3);
        marker.setLng(114.2);
        marker.setCategory("accessible_toilet");
        marker.setTitle("Original title");
        marker.setDescription("Original approved description");
        marker.setUsername("owner");
        marker.setUserPublicId("owner-public-id");
        marker.setLastEditedBy("owner");
        marker.setLastEditedByPublicId("owner-public-id");
        marker.setCreatedAt(Instant.parse("2025-01-01T00:00:00Z"));
        marker.setUpdatedAt(Instant.parse("2025-01-01T00:00:00Z"));
        return marker;
    }

    private static MarkerEditProposal proposal(MapMarker marker, String title) {
        MarkerEditProposal proposal = new MarkerEditProposal();
        proposal.setMarkerId(marker.getId());
        proposal.setBaseMarkerVersion(marker.getVersion());
        proposal.setMarkerTitle(marker.getTitle());
        proposal.setMarkerLat(marker.getLat());
        proposal.setMarkerLng(marker.getLng());
        proposal.setProposerUsername("editor");
        proposal.setProposerPublicId("editor-public-id");
        proposal.setProposerIsOwner(false);
        proposal.setCategory("friendly_clinic");
        proposal.setTitle(title);
        proposal.setDescription("Description for " + title);
        proposal.setIsPublic(false);
        proposal.setIsActive(false);
        proposal.setCreatedAt(Instant.parse("2025-01-01T00:00:00Z"));
        return proposal;
    }

    private static MockHttpSession reviewer(String username) {
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("username", username);
        return session;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class JsonConfiguration {
        @Bean
        ObjectMapper objectMapper() {
            return new ObjectMapper().findAndRegisterModules();
        }
    }
}
