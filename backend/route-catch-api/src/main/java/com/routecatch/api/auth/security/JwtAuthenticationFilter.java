package com.routecatch.api.auth.security;

import java.io.IOException;
import java.util.Collections;
import java.util.UUID;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.auth.service.JwtTokenService;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

	private static final String BEARER_PREFIX = "Bearer ";

	private final JwtTokenService jwtTokenService;
	private final UserRepository userRepository;

	public JwtAuthenticationFilter(
		JwtTokenService jwtTokenService,
		UserRepository userRepository
	) {
		this.jwtTokenService = jwtTokenService;
		this.userRepository = userRepository;
	}

	@Override
	protected void doFilterInternal(
		HttpServletRequest request,
		HttpServletResponse response,
		FilterChain filterChain
	) throws ServletException, IOException {
		String token = extractBearerToken(request);

		if (token != null && jwtTokenService.validateToken(token)) {
			try {
				userRepository.findById(UUID.fromString(jwtTokenService.getUserId(token)))
					.ifPresent((user) -> authenticate(user, token));
			} catch (IllegalArgumentException exception) {
				SecurityContextHolder.clearContext();
			}
		}

		filterChain.doFilter(request, response);
	}

	private String extractBearerToken(HttpServletRequest request) {
		String authorizationHeader = request.getHeader("Authorization");

		if (
			authorizationHeader == null ||
			!authorizationHeader.startsWith(BEARER_PREFIX)
		) {
			return null;
		}

		return authorizationHeader.substring(BEARER_PREFIX.length());
	}

	private void authenticate(UserEntity user, String token) {
		UsernamePasswordAuthenticationToken authentication =
			new UsernamePasswordAuthenticationToken(
				user,
				token,
				Collections.emptyList()
			);

		SecurityContextHolder.getContext().setAuthentication(authentication);
	}
}
