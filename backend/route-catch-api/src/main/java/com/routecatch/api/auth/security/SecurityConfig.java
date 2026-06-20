package com.routecatch.api.auth.security;

import static org.springframework.security.config.Customizer.withDefaults;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {

	private final JwtAuthenticationFilter jwtAuthenticationFilter;
	private final JsonAuthenticationEntryPoint authenticationEntryPoint;

	public SecurityConfig(
		JwtAuthenticationFilter jwtAuthenticationFilter,
		JsonAuthenticationEntryPoint authenticationEntryPoint
	) {
		this.jwtAuthenticationFilter = jwtAuthenticationFilter;
		this.authenticationEntryPoint = authenticationEntryPoint;
	}

	@Bean
	public SecurityFilterChain securityFilterChain(HttpSecurity http)
		throws Exception {
		return http
			.cors(withDefaults())
			.csrf(AbstractHttpConfigurer::disable)
			.formLogin(AbstractHttpConfigurer::disable)
			.httpBasic(AbstractHttpConfigurer::disable)
			.sessionManagement((session) ->
				session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
			)
			.exceptionHandling((exceptions) ->
				exceptions.authenticationEntryPoint(authenticationEntryPoint)
			)
			.authorizeHttpRequests((requests) -> requests
				.requestMatchers(HttpMethod.OPTIONS, "/api/**").permitAll()
				.requestMatchers(HttpMethod.GET, "/api/health").permitAll()
				.requestMatchers("/ws").permitAll()
				.requestMatchers("/ws/**").permitAll()
				.requestMatchers("/api/routes").permitAll()
				.requestMatchers("/api/nearest").permitAll()
				.requestMatchers("/api/auth/register").permitAll()
				.requestMatchers("/api/auth/login").permitAll()
				.requestMatchers(HttpMethod.GET, "/api/auth/me").authenticated()
				.requestMatchers(HttpMethod.GET, "/api/game/creatures").permitAll()
				.requestMatchers("/api/game/me/**").authenticated()
				.requestMatchers("/api/game/sessions/**").permitAll()
				.requestMatchers("/api/game/leaderboard").permitAll()
				.requestMatchers("/api/game/players/*/stats").permitAll()
				.anyRequest().authenticated()
			)
			.addFilterBefore(
				jwtAuthenticationFilter,
				UsernamePasswordAuthenticationFilter.class
			)
			.build();
	}
}
