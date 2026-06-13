package com.routecatch.api.game.persistence;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;

public interface GameSessionRepository
	extends JpaRepository<GameSessionEntity, UUID> {

	List<GameSessionEntity> findAllByOrderByCreatedAtDesc(Pageable pageable);

	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("""
		select gameSession
		from GameSessionEntity gameSession
		where gameSession.sessionId = :sessionId
		""")
	Optional<GameSessionEntity> findByIdForUpdate(
		@Param("sessionId") UUID sessionId
	);
}
