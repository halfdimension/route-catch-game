package com.routecatch.api.game.controller;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.routecatch.api.game.creature.CreatureCatalogService;
import com.routecatch.api.game.creature.CreatureDefinition;

@RestController
@RequestMapping("/api/game/creatures")
public class CreatureCatalogController {

	private final CreatureCatalogService creatureCatalogService;

	public CreatureCatalogController(
		CreatureCatalogService creatureCatalogService
	) {
		this.creatureCatalogService = creatureCatalogService;
	}

	@GetMapping
	public List<CreatureDefinition> getAllCreatures() {
		return creatureCatalogService.getAllCreatures();
	}
}
