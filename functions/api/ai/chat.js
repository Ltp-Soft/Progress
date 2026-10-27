/**
 * Cloudflare Pages Functions - /api/ai/chat
 * Powers Mina AI Assistant with Cloudflare Workers AI (Restricted to ADMIN / BOSS / PROJECT_ADMIN / DEPT_ADMIN)
 */
import worker from "../../../worker.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  // Nếu Pages có gắn DB D1, chuyển thẳng qua worker.js để kiểm tra Quota AI theo gói cước & Role
  if (env && env.DB) {
    return worker.fetch(request, env);
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };

  try {
    const body = await request.json();
    const { messages, projectContext, userRole } = body;

    if (userRole && ["STAFF", "GUEST"].includes(String(userRole).toUpperCase())) {
      return new Response(
        JSON.stringify({ error: "Trợ lý AI Mina chỉ dành cho cấp Quản lý / Admin để tối ưu hạn mức hệ thống." }),
        { status: 403, headers }
      );
    }

    const systemPrompt = `Bạn là Mina - trợ lý ảo điều phối tiến độ thông minh, thân thiện và sắc sảo của nền tảng quản trị dự án & tiến độ thi công LTP Progress Hub (thuộc hệ sinh thái LTP Soft).

CÁC QUY TẮC PHẢN HỒI BẮT BUỘC:
1. TRẢ LỜI NGẮN GỌN, TRỌNG TÂM, ĐI THẲNG VÀO CÂU HỎI:
   - Hỏi gì trả lời thẳng vào đáp án trong 1-3 câu ngắn gọn, súc tích.
   - Xưng "em" hoặc "Mina", gọi người dùng là "anh/chị". Dùng biểu cảm chuyên nghiệp, sinh động (😊, ✨, 📋, 📊).
2. SO SÁNH VÀ ĐỌC DỮ LIỆU CHÍNH XÁC 100%:
   - Đọc kỹ trường "nhanVienLamNhieuTaskNhat", "nhanVienLamItTaskNhat" và "bangXepHangNhanSuGiamDan" trong DỮ LIỆU DỰ ÁN bên dưới.
3. TUÂN THỦ NGÔN NGỮ YÊU CẦU:
   - Nếu người dùng yêu cầu trả lời bằng tiếng Hàn, tiếng Anh, tiếng Trung... bắt buộc phản hồi 100% bằng ngôn ngữ đó.

DỮ LIỆU DỰ ÁN THỰC TẾ TRÊN MÀN HÌNH:
${JSON.stringify(projectContext || {}, null, 2)}`;

    if (env.AI) {
      const aiMessages = [
        { role: "system", content: systemPrompt },
        ...(messages || [])
      ];

      const candidateModels = [
        "@cf/meta/llama-4-scout-17b-16e-instruct",
        "@cf/meta/llama-3.2-3b-instruct",
        "@cf/utter-project/eurollm-9b-it",
        "@cf/zhipuai/glm-4.7-flash"
      ];

      let replyText = "";
      let lastError = null;

      for (const model of candidateModels) {
        try {
          const aiResponse = await env.AI.run(model, {
            messages: aiMessages,
            max_tokens: 1024,
            temperature: 0.3
          });

          replyText = aiResponse?.response || aiResponse?.text || aiResponse?.result?.response || aiResponse?.choices?.[0]?.message?.content;
          if (replyText) {
            return new Response(JSON.stringify({ reply: replyText, modelUsed: model }), { headers });
          }
        } catch (err) {
          lastError = err.message;
        }
      }

      if (!replyText) {
        return new Response(JSON.stringify({ error: `Không thể gọi AI: ${lastError}` }), {
          status: 500,
          headers
        });
      }
    } else {
      return new Response(JSON.stringify({ error: "Binding AI chưa được cấu hình trên Pages" }), {
        status: 503,
        headers
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
