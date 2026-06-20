package com.routecatch.api.multiplayer.security;

import java.util.Collections;
import java.util.List;
import java.util.UUID;

import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.core.Authentication;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Component;

import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;
import com.routecatch.api.auth.service.JwtTokenService;

@Component
public class StompJwtChannelInterceptor implements ChannelInterceptor {

	private static final String BEARER_PREFIX = "Bearer ";
	private static final String AUTHENTICATION_SESSION_ATTRIBUTE = "authentication";
	private static final String USER_ID_SESSION_ATTRIBUTE = "userId";
	private static final String USERNAME_SESSION_ATTRIBUTE = "username";
	private static final String DISPLAY_NAME_SESSION_ATTRIBUTE = "displayName";

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
		StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(
			message,
			StompHeaderAccessor.class
		);

		if (accessor == null) {
			return message;
		}

		if (accessor.getCommand() != StompCommand.CONNECT) {
			reattachAuthentication(accessor);
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

		Authentication authentication = new UsernamePasswordAuthenticationToken(
			user,
			token,
			Collections.emptyList()
		);

		accessor.setUser(authentication);
		storeAuthentication(accessor, authentication, user);

		return message;
	}

	private void reattachAuthentication(StompHeaderAccessor accessor) {
		if (accessor.getUser() != null || accessor.getSessionAttributes() == null) {
			return;
		}

		Object authentication = accessor
			.getSessionAttributes()
			.get(AUTHENTICATION_SESSION_ATTRIBUTE);

		if (authentication instanceof Authentication stompAuthentication) {
			accessor.setUser(stompAuthentication);
		}
	}

	private void storeAuthentication(
		StompHeaderAccessor accessor,
		Authentication authentication,
		UserEntity user
	) {
		if (accessor.getSessionAttributes() == null) {
			return;
		}

		accessor
			.getSessionAttributes()
			.put(AUTHENTICATION_SESSION_ATTRIBUTE, authentication);
		accessor
			.getSessionAttributes()
			.put(USER_ID_SESSION_ATTRIBUTE, user.getUserId().toString());
		accessor
			.getSessionAttributes()
			.put(USERNAME_SESSION_ATTRIBUTE, user.getUsername());
		accessor
			.getSessionAttributes()
			.put(DISPLAY_NAME_SESSION_ATTRIBUTE, user.getDisplayName());
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
