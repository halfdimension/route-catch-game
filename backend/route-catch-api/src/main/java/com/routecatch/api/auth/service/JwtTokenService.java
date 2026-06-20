package com.routecatch.api.auth.service;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

import javax.crypto.SecretKey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.routecatch.api.auth.persistence.UserEntity;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

@Service
public class JwtTokenService {

	private final SecretKey signingKey;
	private final Duration tokenExpiration;

	public JwtTokenService(
		@Value("${auth.jwt.secret:route-catch-dev-secret-change-me-route-catch-dev-secret-change-me}")
		String jwtSecret,
		@Value("${auth.jwt.expiration:24h}") Duration tokenExpiration
	) {
		this.signingKey = Keys.hmacShaKeyFor(
			jwtSecret.getBytes(StandardCharsets.UTF_8)
		);
		this.tokenExpiration = tokenExpiration;
	}

	public String generateToken(UserEntity user) {
		Instant issuedAt = Instant.now();
		Instant expiresAt = issuedAt.plus(tokenExpiration);

		return Jwts.builder()
			.subject(user.getUserId().toString())
			.claim("userId", user.getUserId().toString())
			.claim("username", user.getUsername())
			.issuedAt(Date.from(issuedAt))
			.expiration(Date.from(expiresAt))
			.signWith(signingKey)
			.compact();
	}

	public boolean validateToken(String token) {
		try {
			parseClaims(token);
			return true;
		} catch (JwtException | IllegalArgumentException exception) {
			return false;
		}
	}

	public String getUserId(String token) {
		return parseClaims(token).get("userId", String.class);
	}

	public String getUsername(String token) {
		return parseClaims(token).get("username", String.class);
	}

	private Claims parseClaims(String token) {
		return Jwts.parser()
			.verifyWith(signingKey)
			.build()
			.parseSignedClaims(token)
			.getPayload();
	}
}
