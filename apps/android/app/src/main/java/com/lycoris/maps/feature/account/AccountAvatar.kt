package com.lycoris.maps.feature.account

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import coil3.ImageLoader
import coil3.compose.AsyncImage
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.lycoris.maps.core.designsystem.LycorisColors
import com.lycoris.maps.core.data.AccountState
import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.model.User
import com.lycoris.maps.core.network.ApiClients
import com.lycoris.maps.core.network.ImageVariant

@Composable
internal fun SearchAccountAvatar(account: AccountState, clients: ApiClients, language: Language) {
    val user = account.user
    if (user == null) {
        Box(Modifier.size(36.dp).clip(CircleShape).background(Color(0xFFC7C7CB)), contentAlignment = Alignment.Center) {
            Text("AA", fontSize = 14.sp, color = Color(0xFFF7F7F6))
        }
    } else key(user.publicId, account.epoch, user.avatarUrl) {
        AccountAvatar(user, account.epoch, clients, language, Modifier.size(36.dp), compact = true)
    }
}

@Composable
internal fun AccountAvatar(user: User, epoch: Long, clients: ApiClients, language: Language, modifier: Modifier = Modifier, compact: Boolean = false) {
    val context = LocalContext.current
    val resource = remember(user.avatarUrl, clients) { clients.resolveImage(user.avatarUrl, ImageVariant.THUMB, publiclyVisible = true) }
    val loader = remember(context, clients, user.publicId, epoch, resource?.mayNeedSession) {
        val client = if (resource?.mayNeedSession == true) clients.authenticatedClient(epoch) else clients.publicMediaClient
        ImageLoader.Builder(context.applicationContext)
            .memoryCache(null).diskCache(null)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { client })) }
            .build()
    }
    DisposableEffect(loader) { onDispose { loader.shutdown() } }
    var loading by remember(resource, user.publicId, epoch) { mutableStateOf(resource != null) }
    var failed by remember(resource, user.publicId, epoch) { mutableStateOf(false) }
    Box(modifier.clip(CircleShape).background(LycorisColors.Card), contentAlignment = Alignment.Center) {
        if (resource == null || failed || loading) Text(initials(user.displayName),
            style = if (compact) MaterialTheme.typography.labelLarge else MaterialTheme.typography.headlineSmall, color = LycorisColors.Primary)
        if (resource != null && !failed) {
            val request = remember(resource, user.publicId, epoch) {
                ImageRequest.Builder(context).data(resource.url.toString())
                    .memoryCachePolicy(CachePolicy.DISABLED).diskCachePolicy(CachePolicy.DISABLED)
                    .build()
            }
            AsyncImage(request, imageLoader = loader, contentDescription = language.text("头像", "Avatar"),
                modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop,
                onSuccess = { loading = false }, onError = { loading = false; failed = true })
        }
        if (loading) CircularProgressIndicator(Modifier.size(if (compact) 16.dp else 24.dp), strokeWidth = 2.dp)
    }
}

internal fun initials(displayName: String): String = displayName.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2)
    .joinToString("") { String(Character.toChars(it.codePointAt(0))).uppercase() }.ifEmpty { "L" }
