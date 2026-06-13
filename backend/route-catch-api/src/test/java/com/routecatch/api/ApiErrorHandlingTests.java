package com.routecatch.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "osrm.base-url=http://127.0.0.1:1")
@AutoConfigureMockMvc
class ApiErrorHandlingTests {

	@Autowired
	private MockMvc mockMvc;

	@Test
	void invalidLatitudeReturnsCleanValidationError() throws Exception {
		mockMvc.perform(post("/api/routes")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"sourceLat": 91,
						"sourceLon": 77.2090,
						"destinationLat": 28.6200,
						"destinationLon": 77.2150
					}
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("VALIDATION_ERROR"))
			.andExpect(jsonPath("$.message").value("sourceLat must be between -90 and 90"))
			.andExpect(jsonPath("$.path").value("/api/routes"))
			.andExpect(jsonPath("$.timestamp").isNotEmpty());
	}

	@Test
	void malformedJsonReturnsCleanBadRequest() throws Exception {
		mockMvc.perform(post("/api/routes")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{"sourceLat": 28.6139,
					"""))
			.andExpect(status().isBadRequest())
			.andExpect(jsonPath("$.errorCode").value("MALFORMED_JSON"))
			.andExpect(jsonPath("$.message").value("Request body is malformed"))
			.andExpect(jsonPath("$.path").value("/api/routes"))
			.andExpect(jsonPath("$.timestamp").isNotEmpty());
	}

	@Test
	void unavailableOsrmReturnsCleanBadGateway() throws Exception {
		mockMvc.perform(post("/api/routes")
				.contentType(MediaType.APPLICATION_JSON)
				.content("""
					{
						"sourceLat": 28.6139,
						"sourceLon": 77.2090,
						"destinationLat": 28.6200,
						"destinationLon": 77.2150
					}
					"""))
			.andExpect(status().isBadGateway())
			.andExpect(jsonPath("$.errorCode").value("ROUTING_ENGINE_UNAVAILABLE"))
			.andExpect(jsonPath("$.message").value("Routing engine is not reachable"))
			.andExpect(jsonPath("$.path").value("/api/routes"))
			.andExpect(jsonPath("$.timestamp").isNotEmpty());
	}

	@Test
	void deleteCatchEndpointReturnsCleanMethodNotAllowed() throws Exception {
		UUID sessionId = UUID.randomUUID();
		String path = "/api/game/sessions/" + sessionId + "/catches";

		mockMvc.perform(delete(path))
			.andExpect(status().isMethodNotAllowed())
			.andExpect(jsonPath("$.errorCode").value("METHOD_NOT_ALLOWED"))
			.andExpect(jsonPath("$.message").value(
				"HTTP method is not supported for this endpoint"
			))
			.andExpect(jsonPath("$.path").value(path))
			.andExpect(jsonPath("$.timestamp").isNotEmpty());
	}

	@Test
	void getNearestEndpointReturnsCleanMethodNotAllowed() throws Exception {
		assertMethodNotAllowed("/api/nearest");
	}

	@Test
	void getRoutesEndpointReturnsCleanMethodNotAllowed() throws Exception {
		assertMethodNotAllowed("/api/routes");
	}

	private void assertMethodNotAllowed(String path) throws Exception {
		mockMvc.perform(get(path))
			.andExpect(status().isMethodNotAllowed())
			.andExpect(jsonPath("$.errorCode").value("METHOD_NOT_ALLOWED"))
			.andExpect(jsonPath("$.message").value(
				"HTTP method is not supported for this endpoint"
			))
			.andExpect(jsonPath("$.path").value(path))
			.andExpect(jsonPath("$.timestamp").isNotEmpty());
	}
}
