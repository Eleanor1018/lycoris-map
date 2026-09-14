package com.lycoris.repository;

import com.lycoris.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;


public interface UserRepository extends JpaRepository<User,Integer> {
    Optional<User> findByUsername(String username);
    Optional<User> findByEmail(String email);
    Optional<User> findById(Integer id);

    Optional<User> findByUsernameAndDeletedFalse(String username);
    Optional<User> findByEmailAndDeletedFalse(String email);
    Optional<User> findByIdAndDeletedFalse(Integer id);
    Optional<User> findByPublicIdAndDeletedFalse(UUID publicId);

    boolean existsByUsername(String username);
    boolean existsByEmail(String email);
    boolean existsById(Integer id);

    @Query("""
            select u from User u
            where (:q is null or :q = '' or
                   lower(u.username) like lower(concat('%', :q, '%')) or
                   lower(u.nickname) like lower(concat('%', :q, '%')) or
                   lower(u.email) like lower(concat('%', :q, '%')))
            """)
    Page<User> searchForAdmin(@Param("q") String q, Pageable pageable);
}
