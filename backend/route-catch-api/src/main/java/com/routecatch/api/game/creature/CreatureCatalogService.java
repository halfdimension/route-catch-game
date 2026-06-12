package com.routecatch.api.game.creature;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.routecatch.api.game.exception.CreatureNotFoundException;

@Service
public class CreatureCatalogService {

	private final List<CreatureDefinition> creatures = List.of(
		new CreatureDefinition("sparkbit", "Sparkbit", "common", 10),
		new CreatureDefinition("roadling", "Roadling", "common", 10),
		new CreatureDefinition("dustpup", "Dustpup", "common", 10),
		new CreatureDefinition("signalbug", "Signalbug", "common", 10),
		new CreatureDefinition("voltfox", "Voltfox", "rare", 30),
		new CreatureDefinition("driftclaw", "Driftclaw", "rare", 30),
		new CreatureDefinition("metrogeist", "Metrogeist", "rare", 30),
		new CreatureDefinition("thunderwyrm", "Thunderwyrm", "legendary", 100),
		new CreatureDefinition("chronodrake", "Chronodrake", "legendary", 100)
	);

	private final Map<String, CreatureDefinition> creaturesById =
		createCreatureIndex();

	public CreatureDefinition getCreatureById(String creatureId) {
		CreatureDefinition creature = creaturesById.get(creatureId);

		if (creature == null) {
			throw new CreatureNotFoundException(creatureId);
		}

		return creature;
	}

	public List<CreatureDefinition> getAllCreatures() {
		return creatures;
	}

	private Map<String, CreatureDefinition> createCreatureIndex() {
		Map<String, CreatureDefinition> index = new LinkedHashMap<>();

		for (CreatureDefinition creature : creatures) {
			index.put(creature.creatureId(), creature);
		}

		return Map.copyOf(index);
	}
}
