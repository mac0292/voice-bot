import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


def get_response(messages: list, max_tokens: int = 300) -> str:
    """
    Accepts full message history (system prompt + conversation).
    Returns GPT-4o response as a string.

    messages format:
    [
        {"role": "system",    "content": "You are a teacher..."},
        {"role": "user",      "content": "What is an API?"},
        {"role": "assistant", "content": "An API is..."},
        {"role": "user",      "content": "Can you give an example?"}
    ]
    """
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=max_tokens,
        messages=messages
    )

    return response.choices[0].message.content.strip()