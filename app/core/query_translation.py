# from langchain_openai import ChatOpenAI
# from dotenv import load_dotenv
# from langchain_google_genai import ChatGoogleGenerativeAI
# import os

# load_dotenv()

# # One model, but cheap - gpt-4o-mini for all translation tasks
# # llm_cheap = ChatOpenAI(model="gpt-4o-mini", temperature=0)
# llm_cheap = ChatGoogleGenerativeAI(model="gemini-1.5-flash", temperature=0)


# def llm_call_A_step_back(query: str) -> str:
#     """Call A: More Abstraction - What is JS execution context?"""
#     prompt = f"Given query '{query}', generate a more abstract, high-level principle question. Just return the question."
#     return llm_cheap.invoke(prompt).content

# def llm_call_B_rewrite(query: str) -> str:
#     """Call B: Rewrite - Same meaning, different words for vector search"""
#     prompt = f"Rewrite this query in 3 alternative phrasings for better retrieval: '{query}'. Return comma separated."
#     return llm_cheap.invoke(prompt).content

# def llm_call_C_decompose(query: str) -> str:
#     """Call C: Less Abstraction - Break into sub-questions"""
#     prompt = f"Decompose '{query}' into 2-3 simple sub-questions. Return numbered list."
#     return llm_cheap.invoke(prompt).content

# def llm_call_D_hyde(query: str) -> str:
#     """Call D: HyDE - Generate hypothetical doc that would answer query"""
#     prompt = f"Write a paragraph that would be the perfect answer to '{query}'. This is a hypothetical document."
#     return llm_cheap.invoke(prompt).content


# import os
# from dotenv import load_dotenv
# from langchain_google_genai import ChatGoogleGenerativeAI

# # Load .env file
# load_dotenv()

# # Check key exists
# api_key = os.getenv("GOOGLE_API_KEY")
# if not api_key:
#     raise ValueError("GOOGLE_API_KEY not found in .env file!")

# # This is our cheap LLM - same model for Call A,B,C,D,E,G,H (like your diagram)
# # gemini-1.5-flash = fast + free + perfect for translation
# llm_cheap = ChatGoogleGenerativeAI(
#     model="gemini-1.5-flash",
#     temperature=0,
#     google_api_key=api_key
# )

# # Expensive LLM only for Final Generation - Call F
# llm_expensive = ChatGoogleGenerativeAI(
#     model="gemini-1.5-pro",
#     temperature=0,
#     google_api_key=api_key
# )

# # ============ 4 PARALLEL LLM CALLS - QUERY TRANSLATION HUB ============

# def llm_call_A_step_back(query: str) -> str:
#     """Call A: More Abstraction - Like 'What is JS execution context?'"""
#     prompt = f"""
#     You are Step Back Prompting expert.
#     Given specific query: '{query}'
#     Generate a more abstract, high-level principle question that would help answer it.
#     Example: 'What is TDZ in nodejs?' -> 'How does JavaScript handle variable hoisting and execution context?'
#     Return ONLY the abstract question, no extra text.
#     """
#     response = llm_cheap.invoke(prompt)
#     return response.content

# def llm_call_B_rewrite(query: str) -> str:
#     """Call B: Rewrite - Same meaning, different words"""
#     prompt = f"""
#     You are Query Rewrite expert.
#     Rewrite this query in 3 different ways to improve vector search retrieval: '{query}'
#     Return as numbered list.
#     """
#     response = llm_cheap.invoke(prompt)
#     return response.content

# def llm_call_C_decompose(query: str) -> str:
#     """Call C: Less Abstraction - Break into sub-questions"""
#     prompt = f"""
#     You are Query Decomposition expert.
#     Break this complex query into 2-3 simple sub-questions: '{query}'
#     If query is about Temporal Dead Zone, break into: What is TDZ? Why does it happen? Give example.
#     Return as numbered list.
#     """
#     response = llm_cheap.invoke(prompt)
#     return response.content

# def llm_call_D_hyde(query: str) -> str:
#     """Call D: HyDE - Generate hypothetical ideal doc"""
#     prompt = f"""
#     You are HyDE expert.
#     Write a short paragraph (3-4 lines) that would be the perfect document to answer: '{query}'
#     This paragraph will be used for embedding search. Make it factual and detailed.
#     """
#     response = llm_cheap.invoke(prompt)
#     return response.content


import os
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

load_dotenv()

api_key = os.getenv("GOOGLE_API_KEY")

if not api_key:
    raise ValueError("GOOGLE_API_KEY missing in .env - check D:\\fastapi\\.env")

# UPDATED MODEL NAME - 2026 free model
llm_cheap = ChatGoogleGenerativeAI(
    model="gemini-3.8-flash",  # Changed from 1.5-flash to 2.0-flash
    temperature=0,
    google_api_key=api_key
)

def llm_call_A_step_back(query: str) -> str:
    try:
        prompt = f"Given query '{query}', generate a more abstract high-level question. Return only question."
        return llm_cheap.invoke(prompt).content
    except Exception as e:
        print(f"ERROR in Call A: {e}")
        return f"ERROR: {e}"

def llm_call_B_rewrite(query: str) -> str:
    try:
        prompt = f"Rewrite '{query}' in 3 alternative ways for vector search. Numbered list."
        return llm_cheap.invoke(prompt).content
    except Exception as e:
        print(f"ERROR in Call B: {e}")
        return f"ERROR: {e}"

def llm_call_C_decompose(query: str) -> str:
    try:
        prompt = f"Break '{query}' into 2-3 sub-questions. Numbered list."
        return llm_cheap.invoke(prompt).content
    except Exception as e:
        print(f"ERROR in Call C: {e}")
        return f"ERROR: {e}"

def llm_call_D_hyde(query: str) -> str:
    try:
        prompt = f"Write a 3-line paragraph that perfectly answers: '{query}'"
        return llm_cheap.invoke(prompt).content
    except Exception as e:
        print(f"ERROR in Call D: {e}")
        return f"ERROR: {e}"