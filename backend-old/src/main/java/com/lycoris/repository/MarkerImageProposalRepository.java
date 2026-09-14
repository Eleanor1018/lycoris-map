package com.lycoris.repository;

import com.lycoris.entity.MarkerImageProposal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MarkerImageProposalRepository extends JpaRepository<MarkerImageProposal, Long> {
    List<MarkerImageProposal> findByStatusOrderByCreatedAtDesc(String status);

    List<MarkerImageProposal> findByImageUrl(String imageUrl);
}
