package com.lycoris.repository;

import com.lycoris.entity.MarkerEditProposal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MarkerEditProposalRepository extends JpaRepository<MarkerEditProposal, Long> {
    List<MarkerEditProposal> findByStatusOrderByCreatedAtDesc(String status);
}
