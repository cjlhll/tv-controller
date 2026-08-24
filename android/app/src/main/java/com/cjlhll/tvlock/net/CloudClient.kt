package com.cjlhll.tvlock.net

import android.content.pm.PackageManager
import android.os.Build
import com.cjlhll.tvlock.TvLockApp
import com.cjlhll.tvlock.data.AppPrefs
import com.cjlhll.tvlock.data.DeviceSnapshot
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class CloudClient(private val prefs: AppPrefs) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .writeTimeout(8, TimeUnit.SECONDS)
        .build()

    fun register(): JSONObject {
        val extra = JSONObject()
            .put("name", prefs.deviceName)
            .put("form", detectForm())
        if (prefs.deviceId.isNotEmpty() && prefs.deviceSecret.isNotEmpty()) {
            extra.put("deviceId", prefs.deviceId)
            extra.put("deviceSecret", prefs.deviceSecret)
        }
        val res = post("register", extra, includeAuth = false)
        if (res.optBoolean("ok")) {
            prefs.deviceId = res.optString("deviceId")
            prefs.deviceSecret = res.optString("deviceSecret")
        }
        return res
    }

    fun refreshPair(): JSONObject = post("refreshPair")

    fun state(): JSONObject = post("state")

    fun wake(): JSONObject = post("wake")

    fun pinUnlock(durationMin: Int = 30): JSONObject =
        post("pinUnlock", JSONObject().put("durationMin", durationMin))

    fun lock(): JSONObject = post("lock")

    fun snapshotFrom(res: JSONObject): DeviceSnapshot? = DeviceSnapshot.from(res)

    private fun post(action: String, extra: JSONObject = JSONObject(), includeAuth: Boolean = true): JSONObject {
        val body = extra
        body.put("action", action)
        if (includeAuth && prefs.deviceId.isNotEmpty()) {
            body.put("deviceId", prefs.deviceId)
            body.put("deviceSecret", prefs.deviceSecret)
        }
        val text = if (prefs.serverUrl.startsWith("https://")) {
            val req = Request.Builder()
                .url(prefs.serverUrl)
                .post(body.toString().toRequestBody(JSON))
                .build()
            http.newCall(req).execute().use { resp ->
                resp.body?.string().orEmpty()
            }
        } else {
            rawHttpPost(prefs.serverUrl, body.toString())
        }
        if (text.isEmpty()) {
            return JSONObject().put("ok", false).put("message", "empty response")
        }
        return JSONObject(text)
    }

    private fun rawHttpPost(url: String, json: String): String {
        val u = java.net.URL(url)
        val port = if (u.port > 0) u.port else 80
        val path = if (u.path.isNullOrEmpty()) "/" else u.path
        val payload = json.toByteArray(Charsets.UTF_8)
        java.net.Socket().use { socket ->
            socket.connect(java.net.InetSocketAddress(u.host, port), 8000)
            socket.soTimeout = 8000
            val out = socket.getOutputStream()
            val header = buildString {
                append("POST $path HTTP/1.1\r\n")
                append("Host: ${u.host}\r\n")
                append("Content-Type: application/json; charset=utf-8\r\n")
                append("Content-Length: ${payload.size}\r\n")
                append("Connection: close\r\n\r\n")
            }
            out.write(header.toByteArray(Charsets.US_ASCII))
            out.write(payload)
            out.flush()
            val raw = socket.getInputStream().bufferedReader(Charsets.UTF_8).readText()
            val idx = raw.indexOf("\r\n\r\n")
            return if (idx >= 0) raw.substring(idx + 4) else raw
        }
    }

    private fun detectForm(): String {
        val pm = TvLockApp.instance.packageManager
        return if (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
            pm.hasSystemFeature("android.software.leanback")
        ) {
            "tv"
        } else if (Build.MODEL.contains("BRAVIA", ignoreCase = true)) {
            "tv"
        } else {
            "phone"
        }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
