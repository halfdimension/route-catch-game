package com.routecatch.api.game.persistence;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface CaughtCreatureRepository
	extends JpaRepository<CaughtCreatureEntity, UUID> {

	List<CaughtCreatureEntity> findBySessionIdOrderByCaughtAtDesc(
		UUID sessionId
	);
}
