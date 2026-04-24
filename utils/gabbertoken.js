const API_KEY = "api key";

async function createUsageToken() {
  try {
    const response = await fetch("https://api.gabber.dev/v1/usage/token", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ttl: 3600 // token valid for 1 hour (in seconds)
      })
    });

    // const data = await response.json();
    // console.log("Usage Token:", data);
    console.log("Usage Token:", response);
  } catch (error) {
    console.error("Error creating usage token:", error);
  }
}

createUsageToken();