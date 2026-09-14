package com.lycoris.repository;

import com.lycoris.entity.MarkerFavorite;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface MarkerFavoriteRepository extends JpaRepository<MarkerFavorite, Long> {
    boolean existsByUserPublicIdAndMarkerId(String userPublicId, Long markerId);
    @Modifying
    @Transactional
    @Query("delete from MarkerFavorite f where f.userPublicId = ?1 and f.markerId = ?2")
    void deleteByUserPublicIdAndMarkerId(String userPublicId, Long markerId);
    @Modifying
    @Transactional
    @Query("delete from MarkerFavorite f where f.markerId = ?1")
    void deleteByMarkerId(Long markerId);
    List<MarkerFavorite> findByUserPublicId(String userPublicId);
}
