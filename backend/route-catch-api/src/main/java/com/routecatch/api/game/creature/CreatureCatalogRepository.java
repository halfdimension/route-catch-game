package com.routecatch.api.game.creature;

import org.springframework.data.jpa.repository.JpaRepository;

public interface CreatureCatalogRepository
	extends JpaRepository<CreatureCatalogEntity, String> {
}
