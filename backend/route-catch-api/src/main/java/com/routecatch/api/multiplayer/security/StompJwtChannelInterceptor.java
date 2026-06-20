package com.routecatch.api.multiplayer.security;

import java.util.Collections;
import java.util.List;
import java.util.UUID;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.auth.service.JwtTokenService;

@Component
public class StompJwtChannelInterceptor implements ChannelInterceptor {

	private static final String BEARER_PREFIX = "Bearer ";

	private final JwtTokenService jwtTokenService;
	private final UserRepository userRepository;

	public StompJwtChannelInterceptor(
		JwtTokenService jwtTokenService,
		UserRepository userRepository
	) {
		this.jwtTokenService = jwtTokenService;
		this.userRepository = userRepository;
	}

	@Override
	public Message<?> preSend(Message<?> message, MessageChannel channel) {
		StompHeaderAccessor accessor = StompHeaderAccessor.wrap(message);

		if (accessor.getCommand() != StompCommand.CONNECT) {
			return message;
		}

		String token = bearerToken(accessor);

		if (!jwtTokenService.validateToken(token)) {
			throw new BadCredentialsException("Invalid WebSocket token");
		}

		UserEntity user = userRepository
			.findById(userId(token))
			.orElseThrow(() ->
				new BadCredentialsException("Invalid WebSocket token")
			);

		accessor.setUser(new UsernamePasswordAuthenticationToken(
			user,
			token,
			Collections.emptyList()
		));

		return message;
	}

	private String bearerToken(StompHeaderAccessor accessor) {
		String authorizationHeader = firstHeader(accessor, "Authorization");

		if (authorizationHeader == null) {
			authorizationHeader = firstHeader(accessor, "authorization");
		}

		if (
			authorizationHeader == null ||
			!authorizationHeader.startsWith(BEARER_PREFIX)
		) {
			throw new BadCredentialsException("Missing WebSocket token");
		}

		return authorizationHeader.substring(BEARER_PREFIX.length());
	}

	private String firstHeader(StompHeaderAccessor accessor, String name) {
		List<String> headers = accessor.getNativeHeader(name);

		if (headers == null || headers.isEmpty()) {
			return null;
		}

		return headers.getFirst();
	}

	private UUID userId(String token) {
		try {
			return UUID.fromString(jwtTokenService.getUserId(token));
		} catch (IllegalArgumentException exception) {
			throw new BadCredentialsException("Invalid WebSocket token");
		}
	}
}
