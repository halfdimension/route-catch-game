package com.routecatch.api.game.creature;

import java.util.List;

import org.springframework.stereotype.Service;

import com.routecatch.api.game.exception.CreatureNotFoundException;

@Service
public class CreatureCatalogService {

	private final CreatureCatalogRepository creatureCatalogRepository;

	public CreatureCatalogService(
		CreatureCatalogRepository creatureCatalogRepository
	) {
		this.creatureCatalogRepository = creatureCatalogRepository;
	}

	public CreatureDefinition getCreatureById(String creatureId) {
		return creatureCatalogRepository.findById(creatureId)
			.map(this::toDefinition)
			.orElseThrow(() -> new CreatureNotFoundException(creatureId));
	}

	public List<CreatureDefinition> getAllCreatures() {
		return creatureCatalogRepository.findAll().stream()
			.map(this::toDefinition)
			.toList();
	}

	private CreatureDefinition toDefinition(CreatureCatalogEntity entity) {
		return new CreatureDefinition(
			entity.getCreatureId(),
			entity.getCreatureName(),
			entity.getRarity(),
			entity.getScoreValue()
		);
	}
}
